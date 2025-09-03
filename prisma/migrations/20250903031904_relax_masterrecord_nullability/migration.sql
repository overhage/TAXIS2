-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blobKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "store" VARCHAR(20),
    "contentType" VARCHAR(100),
    "size" INTEGER,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "rowsTotal" INTEGER,
    "rowsProcessed" INTEGER,
    "outputBlobKey" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "costCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "userId" TEXT,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterRecord" (
    "pairId" TEXT NOT NULL,
    "concept_a" VARCHAR(255) NOT NULL,
    "code_a" VARCHAR(20) NOT NULL,
    "concept_b" VARCHAR(255) NOT NULL,
    "code_b" VARCHAR(20) NOT NULL,
    "system_a" VARCHAR(12) NOT NULL,
    "system_b" VARCHAR(12) NOT NULL,
    "type_a" VARCHAR(20),
    "type_b" VARCHAR(20),
    "cooc_obs" INTEGER,
    "nA" INTEGER,
    "nB" INTEGER,
    "total_persons" INTEGER,
    "cooc_event_count" INTEGER NOT NULL,
    "a_before_b" INTEGER,
    "b_before_a" INTEGER,
    "expected_obs" DECIMAL(19,2),
    "lift" DECIMAL(19,4),
    "lift_lower_95" DECIMAL(19,4),
    "lift_upper_95" DECIMAL(19,4),
    "z_score" DECIMAL(19,4),
    "ab_h" DECIMAL(19,2),
    "a_only_h" DECIMAL(19,2),
    "b_only_h" DECIMAL(19,2),
    "neither_h" DECIMAL(19,2),
    "odds_ratio" DECIMAL(19,4),
    "or_lower_95" DECIMAL(19,4),
    "or_upper_95" DECIMAL(19,4),
    "directionality_ratio" DECIMAL(19,4),
    "dir_prop_a_before_b" DECIMAL(19,4),
    "dir_lower_95" DECIMAL(19,4),
    "dir_upper_95" DECIMAL(19,4),
    "confidence_a_to_b" DECIMAL(19,4),
    "confidence_b_to_a" DECIMAL(19,4),
    "relationshipType" VARCHAR(64) NOT NULL,
    "relationshipCode" INTEGER NOT NULL,
    "rational" VARCHAR(1024) NOT NULL,
    "source_count" INTEGER NOT NULL,
    "llm_date" TIMESTAMP(3),
    "llm_name" VARCHAR(100),
    "llm_version" VARCHAR(50),
    "human_date" TIMESTAMP(3),
    "human_reviewer" VARCHAR(254),
    "human_comment" VARCHAR(255),
    "status" VARCHAR(12),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterRecord_pkey" PRIMARY KEY ("pairId")
);

-- CreateTable
CREATE TABLE "LlmCache" (
    "id" TEXT NOT NULL,
    "promptKey" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "MasterRecord_code_a_system_a_idx" ON "MasterRecord"("code_a", "system_a");

-- CreateIndex
CREATE INDEX "MasterRecord_code_b_system_b_idx" ON "MasterRecord"("code_b", "system_b");

-- CreateIndex
CREATE UNIQUE INDEX "LlmCache_promptKey_key" ON "LlmCache"("promptKey");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
