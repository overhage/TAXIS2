-- AlterTable
ALTER TABLE "MasterRecord" ADD COLUMN     "same_day" INTEGER;

-- CreateTable
CREATE TABLE "concept" (
    "concept_id" INTEGER NOT NULL,
    "concept_name" VARCHAR(255) NOT NULL,
    "domain_id" VARCHAR(20) NOT NULL,
    "vocabulary_id" VARCHAR(20) NOT NULL,
    "concept_class_id" VARCHAR(20) NOT NULL,
    "standard_concept" CHAR(1),
    "concept_code" VARCHAR(50) NOT NULL,
    "valid_start_date" DATE NOT NULL,
    "valid_end_date" DATE NOT NULL DEFAULT DATE '2099-12-31',
    "invalid_reason" CHAR(1),

    CONSTRAINT "concept_pkey" PRIMARY KEY ("concept_id")
);

-- CreateIndex
CREATE INDEX "idx_concept_domain" ON "concept"("domain_id");

-- CreateIndex
CREATE INDEX "idx_concept_class" ON "concept"("concept_class_id");

-- CreateIndex
CREATE INDEX "idx_concept_standard" ON "concept"("standard_concept");

-- CreateIndex
CREATE UNIQUE INDEX "ux_concept_vocab_code" ON "concept"("vocabulary_id", "concept_code");
