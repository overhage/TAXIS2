const Busboy = require('busboy');
const fs = require('fs');
const path = require('path');
const { Configuration, OpenAIApi } = require('openai');
const csvParse = require('csv-parse/lib/sync');
const XLSX = require('xlsx');
const prisma = require('./utils/prisma');
const { getUserFromRequest } = require('./utils/auth');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

// Required columns for uploaded files
const REQUIRED_COLUMNS = [
  'concept_a',
  'concept_b',
  'concept_a_t',
  'concept_b_t',
  'system_a',
  'system_b',
  'cooc_event_count',
  'lift_lower_95',
  'lift_upper_95',
];

// Initialize OpenAI client
const openaiApiKey = process.env.OPENAI_API_KEY;
let openaiClient = null;
if (openaiApiKey) {
  const configuration = new Configuration({ apiKey: openaiApiKey });
  openaiClient = new OpenAIApi(configuration);
}

/**
 * Classify a single row using OpenAI and return rel_type, rel_type_t and rationale.
 */
async function classifyRow(row) {
  if (!openaiClient) {
    // If API key is not configured, skip classification
    return { rel_type: 11, rel_type_t: 'No clear relationship', rationale: 'No API key provided' };
  }
  const events_ab = row.cooc_event_count;
  const lift_lower = parseFloat(row.lift_lower_95);
  const lift_upper = parseFloat(row.lift_upper_95);
  // Compute events_ab_ae similar to Python script: actual-to-expected ratio approximated by average of lift CI
  const events_ab_ae = ((lift_lower + lift_upper) / 2) || 1;
  const prompt = `You are an expert diagnostician skilled at identifying clinical relationships between ICD-10-CM diagnosis concepts.\nStatistical indicators provided:\n- events_ab (co-occurrences): ${events_ab}\n- events_ab_ae (actual-to-expected ratio): ${events_ab_ae.toFixed(2)}\n\nInterpretation guidelines:\n- ≥ 2.0: Strong statistical evidence; carefully consider relationships.\n- 1.5–1.99: Moderate evidence; cautious evaluation.\n- 1.0–1.49: Weak evidence; rely primarily on clinical knowledge.\n- < 1.0: Minimal evidence; avoid indirect/speculative claims.\n\nExplicit guidelines to avoid speculation:\n- Direct causation: Only if explicit and clinically accepted.\n- Indirect causation: Only with explicit and named intermediate diagnosis.\n- Common cause: Only with clearly documented third diagnosis.\n- Treatment-caused: Only if explicitly well-documented.\n- Similar presentations: Only if clinically documented similarity exists.\n- Subset relationship: Explicitly broader or unspecified form.\nIf evidence or explicit documentation is lacking, choose category 11 (No clear relationship).\n\nClassify explicitly the relationship between:\n- Concept A: ${row.concept_a_t}\n- Concept B: ${row.concept_b_t}\n\nCategories:\n1: A causes B\n2: B causes A\n3: A indirectly causes B (explicit intermediate required)\n4: B indirectly causes A (explicit intermediate required)\n5: A and B share common cause (explicit third condition required)\n6: Treatment of A causes B (explicit treatment documentation required)\n7: Treatment of B causes A (explicit treatment documentation required)\n8: A and B have similar initial presentations\n9: A is subset of B\n10: B is subset of A\n11: No clear relationship (default)\n\nAnswer exactly as "<number>: <short description>: <concise rationale>".`;
  try {
    const response = await openaiClient.createChatCompletion({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    });
    const reply = response.data.choices[0].message.content.trim();
    const parts = reply.split(':', 3);
    const rel_type = parseInt(parts[0].trim());
    const rel_type_t = parts[1] ? parts[1].trim() : '';
    const rationale = parts[2] ? parts[2].trim() : '';
    return { rel_type, rel_type_t, rationale };
  } catch (err) {
    return { rel_type: 11, rel_type_t: 'No clear relationship', rationale: 'API error' };
  }
}

/**
 * Parse an uploaded buffer into an array of objects and validate columns. Returns {rows, errors}
 */
function parseAndValidate(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  let rows = [];
  if (ext === '.csv') {
    const text = buffer.toString('utf-8');
    const records = csvParse(text, { columns: true, skip_empty_lines: true });
    rows = records;
  } else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  } else {
    return { error: 'Unsupported file type' };
  }
  if (rows.length === 0) {
    return { error: 'File contains no data' };
  }
  // Remove rows that are completely blank
  rows = rows.filter((row) => {
    return Object.values(row).some((val) => String(val).trim() !== '');
  });
  // Validate header columns
  const header = Object.keys(rows[0]).map((h) => h.toLowerCase());
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) {
      return { error: `Missing required column: ${col}` };
    }
  }
  return { rows };
}

exports.handler = async function (event) {
  const user = await getUserFromRequest(event);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  // Create uploads directory if not exists
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return new Promise((resolve, reject) => {
    const busboy = new Busboy({ headers: event.headers });
    let fileBuffer = Buffer.alloc(0);
    let fileName = '';
    let mimeType = '';
    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      fileName = filename;
      mimeType = mimetype;
      file.on('data', (data) => {
        fileBuffer = Buffer.concat([fileBuffer, data]);
      });
    });
    busboy.on('finish', async () => {
      try {
        if (!fileName) {
          resolve({ statusCode: 400, body: JSON.stringify({ error: 'No file provided' }) });
          return;
        }
        // Validate file content
        const { rows, error } = parseAndValidate(fileBuffer, fileName);
        if (error) {
          resolve({ statusCode: 400, body: JSON.stringify({ error }) });
          return;
        }
        // Save uploaded file to disk
        const timestamp = Date.now();
        const blobKey = `${timestamp}_${fileName}`;
        const inputPath = path.join(uploadsDir, blobKey);
        fs.writeFileSync(inputPath, fileBuffer);
        // Create Upload record
        const uploadRecord = await prisma.upload.create({
          data: {
            userId: user.id,
            blobKey,
            originalName: fileName,
            store: 'local',
            contentType: mimeType,
            size: fileBuffer.length,
          },
        });
        // Create Job record
        let jobRecord = await prisma.job.create({
          data: {
            uploadId: uploadRecord.id,
            status: 'running',
            rowsTotal: rows.length,
            rowsProcessed: 0,
            userId: user.id,
            createdAt: new Date(),
          },
        });
        // Process each row: classification
        const outputRows = [];
        let processedCount = 0;
        for (const row of rows) {
          const classification = await classifyRow(row);
          outputRows.push({ ...row, REL_TYPE: classification.rel_type, REL_TYPE_T: classification.rel_type_t, RATIONALE: classification.rationale });
          processedCount++;
          // Update job progress occasionally (optional: skip due to performance)
        }
        // Write output CSV
        const outputFileName = fileName.replace(/\.[^.]+$/, '') + '_validated.csv';
        const outputBlobKey = `${timestamp}_${outputFileName}`;
        const outputPath = path.join(uploadsDir, outputBlobKey);
        const header = Object.keys(outputRows[0]);
        const lines = [];
        lines.push(header.join(','));
        for (const row of outputRows) {
          const values = header.map((h) => {
            const val = row[h];
            const escaped = String(val).replace(/"/g, '""');
            return `"${escaped}"`;
          });
          lines.push(values.join(','));
        }
        fs.writeFileSync(outputPath, lines.join('\n'));
        // Update job record as completed
        jobRecord = await prisma.job.update({
          where: { id: jobRecord.id },
          data: {
            status: 'completed',
            rowsProcessed: processedCount,
            outputBlobKey: outputBlobKey,
            finishedAt: new Date(),
          },
        });
        resolve({ statusCode: 200, body: JSON.stringify({ jobId: jobRecord.id }) });
      } catch (err) {
        console.error(err);
        resolve({ statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) });
      }
    });
    // Write request body to busboy
    const encoding = event.isBase64Encoded ? 'base64' : 'binary';
    busboy.end(Buffer.from(event.body, encoding));
  });
};