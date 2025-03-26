import { GoogleGenAI, Type } from "@google/genai";
import type {
  GenerateContentRequest,
  Schema,
  SchemaType,
} from "@google/generative-ai";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  console.error("Error: Missing Gemini API key in environment variables");
  console.error("Please add GEMINI_API_KEY to your .env file");
  process.exit(1);
}

const genAI = new GoogleGenAI({ apiKey: geminiApiKey });

interface PodcastEpisode {
  id: number;
  title: string;
  description: string;
  datePublished: number;
  duration: number;
  link: string;
  enclosureUrl: string;
  feedTitle: string;
  feedId: number;
}

interface TranscriptSegment {
  speaker: string;
  timestampFrom: string;
  timestampTo: string;
  content: string;
}

interface LabeledTranscriptSegment extends TranscriptSegment {
  labeledSpeaker: string;
}

interface SpeakerMapping {
  [key: string]: string; // speaker ID -> speaker name
}

interface SpeakerSchema {
  type: "object";
  properties: {
    [key: string]: {
      type: "string";
      description: string;
    };
  };
  required: string[];
  propertyOrdering: string[];
}

interface GenerateContentRequestWithSchema extends GenerateContentRequest {
  responseSchema?: Schema;
}

async function loadEpisodeMetadata(
  directory: string,
  metadataFile: string
): Promise<PodcastEpisode | null> {
  try {
    const metadataPath = path.join(directory, metadataFile);

    if (!fs.existsSync(metadataPath)) {
      console.error(`No metadata found at: ${metadataPath}`);
      return null;
    }

    const metadataContent = fs.readFileSync(metadataPath, "utf-8");
    return JSON.parse(metadataContent);
  } catch (error) {
    console.error("Error loading episode metadata:", error);
    return null;
  }
}

async function loadTranscript(
  directory: string,
  transcriptFile: string
): Promise<TranscriptSegment[]> {
  try {
    const transcriptPath = path.join(directory, transcriptFile);

    if (!fs.existsSync(transcriptPath)) {
      console.error(`No transcript found at: ${transcriptPath}`);
      return [];
    }

    const transcriptContent = fs.readFileSync(transcriptPath, "utf-8");
    return JSON.parse(transcriptContent);
  } catch (error) {
    console.error("Error loading transcript:", error);
    return [];
  }
}

async function identifySpeakers(
  transcript: TranscriptSegment[],
  metadata: PodcastEpisode
): Promise<SpeakerMapping> {
  // Get unique speaker IDs from the transcript
  const uniqueSpeakers = [
    ...new Set(transcript.map((segment) => segment.speaker)),
  ];

  // Create a prompt for Gemini to identify the speakers
  const prompt = `You are an expert at analyzing podcast transcripts and identifying speakers. 
  Please analyze this podcast transcript and identify who each speaker is.
  The podcast is titled "${metadata.title}" and is from "${metadata.feedTitle}".
  
  Here are the unique speaker IDs from the transcript:
  ${JSON.stringify(uniqueSpeakers, null, 2)}
  
  Here's the full transcript:
  ${transcript
    .map((segment) => `${segment.speaker}: ${segment.content}`)
    .join("\n")}
  
  For each speaker:
  - If you can confidently identify the speaker, use their full name
  - If you can identify the role but not the name, use the role (e.g., "Host", "Guest")
  - If you cannot identify the speaker, use "Unknown Speaker"
  
  Use consistent naming for the same speaker across different IDs if you can tell it's the same person.
  
  IMPORTANT: Return ONLY a JSON object with speaker IDs as keys and names as values. No other text.`;

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-pro-exp-03-25",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: Object.fromEntries(
            uniqueSpeakers.map((speaker) => [
              speaker,
              {
                type: Type.STRING,
                description: `The identified name or role for ${speaker}`,
                nullable: false,
              },
            ])
          ),
          required: uniqueSpeakers,
        },
      },
    });

    if (!response.text) {
      throw new Error("No response text received from Gemini");
    }

    // Parse the response text as JSON
    const speakerMapping = JSON.parse(response.text) as SpeakerMapping;

    // Ensure all speakers have a mapping
    uniqueSpeakers.forEach((speaker) => {
      if (!speakerMapping[speaker]) {
        speakerMapping[speaker] = "Unknown Speaker";
      }
    });

    return speakerMapping;
  } catch (error: unknown) {
    // If there's an error, return a mapping with "Unknown Speaker" for all speakers
    const fallbackMapping = Object.fromEntries(
      uniqueSpeakers.map((speaker) => [speaker, "Unknown Speaker"])
    );
    return fallbackMapping;
  }
}

async function saveLabeledTranscript(
  directory: string,
  transcriptFile: string,
  labeledTranscript: LabeledTranscriptSegment[]
) {
  const labeledTranscriptPath = path.join(
    directory,
    `${path.parse(transcriptFile).name}_labeled.json`
  );
  fs.writeFileSync(
    labeledTranscriptPath,
    JSON.stringify(labeledTranscript, null, 2)
  );
  console.log(`Labeled transcript saved to: ${labeledTranscriptPath}`);
}

async function findTranscriptFile(
  dataDir: string
): Promise<{ transcriptFile: string; directory: string } | null> {
  try {
    // Recursively search for transcript files
    const findTranscript = (
      dir: string
    ): { transcriptFile: string; directory: string } | null => {
      const files = fs.readdirSync(dir);

      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          const result = findTranscript(fullPath);
          if (result) return result;
        } else if (
          file.endsWith("_transcript.json") &&
          !file.endsWith("_labeled.json")
        ) {
          // Check if labeled version already exists
          const labeledFile = file.replace(
            "_transcript.json",
            "_transcript_labeled.json"
          );
          const labeledPath = path.join(dir, labeledFile);

          if (!fs.existsSync(labeledPath)) {
            return { transcriptFile: file, directory: dir };
          } else {
            console.log(`Skipping ${file} - already labeled`);
          }
        }
      }
      return null;
    };

    return findTranscript(dataDir);
  } catch (error) {
    console.error("Error searching for transcript file:", error);
    return null;
  }
}

async function main() {
  try {
    const dataDir = path.join(process.cwd(), "data");

    // Find the transcript file
    const result = await findTranscriptFile(dataDir);
    if (!result) {
      console.log("No transcript file found in data directory");
      return;
    }

    const { transcriptFile, directory } = result;
    console.log(`Found transcript: ${transcriptFile} in ${directory}`);

    // Get the corresponding metadata file
    const metadataFile = transcriptFile.replace("_transcript.json", ".json");
    const metadata = await loadEpisodeMetadata(directory, metadataFile);

    if (!metadata) {
      console.error(`No metadata found for transcript ${transcriptFile}`);
      return;
    }

    const transcript = await loadTranscript(directory, transcriptFile);
    if (transcript.length === 0) {
      console.error(`Empty transcript for ${transcriptFile}`);
      return;
    }

    try {
      const speakerMapping = await identifySpeakers(transcript, metadata);

      // Create labeled transcript by mapping speaker IDs to names
      const labeledTranscript = transcript.map((segment) => ({
        ...segment,
        labeledSpeaker: speakerMapping[segment.speaker] || "Unknown Speaker",
      }));

      await saveLabeledTranscript(directory, transcriptFile, labeledTranscript);
      console.log("Speaker labeling completed successfully");
    } catch (error) {
      console.error(`Failed to label speakers for ${metadata.title}:`, error);
      // Create a failed.txt file to track failed labeling attempts
      const failedPath = path.join(directory, "failed_labeling.txt");
      fs.appendFileSync(failedPath, `${transcriptFile}\t${metadata.title}\n`);
    }
  } catch (error) {
    console.error("Main process failed:", error);
  }
}

main();
