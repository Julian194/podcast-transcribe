import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { episodesTable, episodeTimestampsTable } from "./db/schema";
import fs from "fs";
import path from "path";

// Type definitions for our data
interface EpisodeData {
  id: number;
  title: string;
  description?: string;
  link?: string;
  guid?: string;
  datePublished?: number;
  dateCrawled?: number;
  enclosureUrl?: string;
  enclosureType?: string;
  enclosureLength?: number;
  duration?: number;
  explicit?: number;
  episode?: number;
  episodeType?: string;
  season?: number;
  image?: string;
  feedItunesId?: number;
  feedImage?: string;
  feedId?: number;
  feedUrl?: string;
  feedAuthor?: string;
  feedTitle?: string;
  feedLanguage?: string;
  chaptersUrl?: string | null;
  transcriptUrl?: string | null;
}

interface TranscriptEntry {
  speaker: string;
  labeledSpeaker?: string;
  timestampFrom: string;
  timestampTo: string;
  content: string;
}

interface ValidatedData {
  episode: EpisodeData;
  transcript?: TranscriptEntry[];
}

function validateEpisodeData(data: any): {
  isValid: boolean;
  errors: string[];
  data?: EpisodeData;
} {
  const errors: string[] = [];

  // Check if data is an object
  if (!data || typeof data !== "object") {
    return { isValid: false, errors: ["Data is not an object"] };
  }

  // Required fields
  if (!data.id || typeof data.id !== "number") {
    errors.push("Missing or invalid id (must be a number)");
  }
  if (!data.title || typeof data.title !== "string") {
    errors.push("Missing or invalid title (must be a string)");
  }

  // Optional fields type checking
  if (data.datePublished && typeof data.datePublished !== "number") {
    errors.push("Invalid datePublished (must be a number)");
  }
  if (data.dateCrawled && typeof data.dateCrawled !== "number") {
    errors.push("Invalid dateCrawled (must be a number)");
  }
  if (data.duration && typeof data.duration !== "number") {
    errors.push("Invalid duration (must be a number)");
  }
  if (data.episode && typeof data.episode !== "number") {
    errors.push("Invalid episode (must be a number)");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: errors.length === 0 ? (data as EpisodeData) : undefined,
  };
}

function validateTranscriptData(data: any): {
  isValid: boolean;
  errors: string[];
  data?: TranscriptEntry[];
} {
  const errors: string[] = [];

  // Check if data is an array
  if (!Array.isArray(data)) {
    return { isValid: false, errors: ["Transcript data must be an array"] };
  }

  // Check each transcript entry
  data.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      errors.push(`Entry ${index} is not an object`);
      return;
    }

    // Required fields
    if (!entry.speaker || typeof entry.speaker !== "string") {
      errors.push(
        `Entry ${index}: Missing or invalid speaker\nFull entry: ${JSON.stringify(
          entry,
          null,
          2
        )}`
      );
    }
    if (!entry.timestampFrom || typeof entry.timestampFrom !== "string") {
      errors.push(
        `Entry ${index}: Missing or invalid timestampFrom\nFull entry: ${JSON.stringify(
          entry,
          null,
          2
        )}`
      );
    }
    if (!entry.timestampTo || typeof entry.timestampTo !== "string") {
      errors.push(
        `Entry ${index}: Missing or invalid timestampTo\nFull entry: ${JSON.stringify(
          entry,
          null,
          2
        )}`
      );
    }
    if (!entry.content || typeof entry.content !== "string") {
      errors.push(
        `Entry ${index}: Missing or invalid content\nFull entry: ${JSON.stringify(
          entry,
          null,
          2
        )}`
      );
    }

    // Validate timestamp format (MM:SS where MM can be any number)
    const timestampRegex = /^\d+:\d{2}$/;

    if (!timestampRegex.test(entry.timestampFrom)) {
      errors.push(
        `Entry ${index}: Invalid timestampFrom format (should be MM:SS)\n` +
          `Timestamp: "${entry.timestampFrom}"\n` +
          `Full entry: ${JSON.stringify(entry, null, 2)}`
      );
    } else {
      // Validate seconds are < 60
      const [, seconds] = entry.timestampFrom.split(":").map(Number);
      if (seconds >= 60) {
        errors.push(
          `Entry ${index}: Invalid timestampFrom - seconds must be less than 60\n` +
            `Timestamp: "${entry.timestampFrom}"\n` +
            `Full entry: ${JSON.stringify(entry, null, 2)}`
        );
      }
    }

    if (!timestampRegex.test(entry.timestampTo)) {
      errors.push(
        `Entry ${index}: Invalid timestampTo format (should be MM:SS)\n` +
          `Timestamp: "${entry.timestampTo}"\n` +
          `Full entry: ${JSON.stringify(entry, null, 2)}`
      );
    } else {
      // Validate seconds are < 60
      const [, seconds] = entry.timestampTo.split(":").map(Number);
      if (seconds >= 60) {
        errors.push(
          `Entry ${index}: Invalid timestampTo - seconds must be less than 60\n` +
            `Timestamp: "${entry.timestampTo}"\n` +
            `Full entry: ${JSON.stringify(entry, null, 2)}`
        );
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    data: errors.length === 0 ? (data as TranscriptEntry[]) : undefined,
  };
}

function findFiles(dir: string, pattern: RegExp): string[] {
  let results: string[] = [];
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      results = results.concat(findFiles(fullPath, pattern));
    } else if (pattern.test(file)) {
      results.push(fullPath);
    }
  }

  return results;
}

async function validateFiles(): Promise<ValidatedData[]> {
  const dataDir = path.join(process.cwd(), "data");
  const validatedData: ValidatedData[] = [];

  // First, find all labeled transcript files recursively
  const labeledTranscriptFiles = findFiles(
    dataDir,
    /_transcript_labeled\.json$/
  );

  console.log(`Found ${labeledTranscriptFiles.length} labeled transcripts\n`);
  console.log("Starting data validation...\n");

  for (const transcriptPath of labeledTranscriptFiles) {
    // Get the corresponding episode file
    const episodePath = transcriptPath.replace(
      "_transcript_labeled.json",
      ".json"
    );

    if (!fs.existsSync(episodePath)) {
      console.log(
        `⚠️ Episode file not found for transcript: ${transcriptPath}`
      );
      continue;
    }

    console.log(`\nValidating episode: ${path.basename(episodePath)}`);

    try {
      // Read and validate episode data
      const episodeContent = fs.readFileSync(episodePath, "utf-8");
      const episodeData = JSON.parse(episodeContent);

      const episodeValidation = validateEpisodeData(episodeData);
      if (!episodeValidation.isValid || !episodeValidation.data) {
        console.error(`Invalid episode data in ${path.basename(episodePath)}:`);
        episodeValidation.errors.forEach((error) =>
          console.error(`- ${error}`)
        );
        continue;
      }

      console.log(`✓ Episode data valid: ${path.basename(episodePath)}`);
      console.log(`  Title: ${episodeData.title}`);
      console.log(`  ID: ${episodeData.id}`);
      console.log(
        `  Published: ${new Date(
          episodeData.datePublished * 1000
        ).toISOString()}`
      );

      // Read and validate transcript data
      const transcriptContent = fs.readFileSync(transcriptPath, "utf-8");
      const transcriptData = JSON.parse(transcriptContent);

      const transcriptValidation = validateTranscriptData(transcriptData);
      if (!transcriptValidation.isValid) {
        console.error(
          `Invalid transcript data in ${path.basename(transcriptPath)}:`
        );
        transcriptValidation.errors.forEach((error) =>
          console.error(`- ${error}`)
        );
        continue;
      }

      const transcriptEntries = transcriptValidation.data;
      console.log(`✓ Transcript data valid: ${path.basename(transcriptPath)}`);
      console.log(`  Entries: ${transcriptEntries?.length}`);

      validatedData.push({
        episode: episodeValidation.data,
        transcript: transcriptEntries,
      });
    } catch (error) {
      console.error(
        `Error processing files ${path.basename(episodePath)}:`,
        error
      );
    }
  }

  return validatedData;
}

async function insertData(validatedData: ValidatedData[]) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  try {
    console.log("\nInserting validated data into database...");

    for (const { episode, transcript } of validatedData) {
      try {
        // Check if episode already exists
        const existing = await db
          .select()
          .from(episodesTable)
          .where(eq(episodesTable.externalId, String(episode.id)));

        if (existing.length > 0) {
          console.log(
            `Skipping episode ${episode.title} (and its timestamps) - already exists in database`
          );
          continue; // Skip this episode entirely
        }

        // Insert episode
        const [insertedEpisode] = await db
          .insert(episodesTable)
          .values({
            externalId: String(episode.id),
            title: episode.title,
            description: episode.description || null,
            link: episode.link || null,
            guid: episode.guid || null,
            datePublished: episode.datePublished
              ? new Date(episode.datePublished * 1000)
              : null,
            dateCrawled: episode.dateCrawled
              ? new Date(episode.dateCrawled * 1000)
              : null,
            enclosureUrl: episode.enclosureUrl || null,
            enclosureType: episode.enclosureType || null,
            enclosureLength: episode.enclosureLength || null,
            duration: episode.duration || null,
            explicit: Boolean(episode.explicit),
            episode: episode.episode || null,
            episodeType: episode.episodeType || null,
            season: episode.season || null,
            image: episode.image || null,
            feedItunesId: episode.feedItunesId || null,
            feedImage: episode.feedImage || null,
            feedId: episode.feedId || null,
            feedUrl: episode.feedUrl || null,
            feedAuthor: episode.feedAuthor || null,
            feedTitle: episode.feedTitle || null,
            feedLanguage: episode.feedLanguage || null,
            chaptersUrl: episode.chaptersUrl || null,
            transcriptUrl: episode.transcriptUrl || null,
          })
          .returning();

        console.log(`✓ Inserted episode: ${episode.title}`);

        // Insert timestamps if they exist
        if (transcript && transcript.length > 0) {
          const timestamps = transcript.map((ts) => ({
            episodeId: insertedEpisode.id,
            speaker: ts.speaker,
            labeledSpeaker: ts.labeledSpeaker || null,
            timestampFrom: ts.timestampFrom,
            timestampTo: ts.timestampTo,
            content: ts.content,
          }));

          await db.insert(episodeTimestampsTable).values(timestamps);
          console.log(
            `✓ Inserted ${timestamps.length} timestamps for episode: ${episode.title}`
          );
        }
      } catch (error) {
        console.error(
          `Error inserting data for episode ${episode.title}:`,
          error
        );
      }
    }

    // Verify the data
    const episodes = await db.select().from(episodesTable);
    console.log(`\nTotal episodes in database: ${episodes.length}`);

    const timestamps = await db.select().from(episodeTimestampsTable);
    console.log(`Total timestamps in database: ${timestamps.length}`);
  } catch (error) {
    console.error("Database error:", error);
  } finally {
    await pool.end();
  }
}

async function main() {
  const validatedData = await validateFiles();
  console.log(`\nValidated ${validatedData.length} episodes`);

  if (validatedData.length > 0) {
    await insertData(validatedData);
  }
}

main().catch(console.error);
