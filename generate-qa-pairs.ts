import { GoogleGenAI, Type } from "@google/genai";
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

interface LabeledTranscriptSegment {
  speaker: string;
  timestampFrom: string;
  timestampTo: string;
  content: string;
  labeledSpeaker: string;
}

interface QAPair {
  question: string;
  answer: string;
  questionSpeaker: string;
  answerSpeaker: string;
  timestampFrom: string;
  timestampTo: string;
}

async function loadLabeledTranscript(
  directory: string,
  transcriptFile: string
): Promise<LabeledTranscriptSegment[]> {
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

async function generateQAPairs(
  transcript: LabeledTranscriptSegment[]
): Promise<QAPair[]> {
  // Create a prompt for Gemini to generate Q&A pairs
  const prompt = `You are an expert at analyzing podcast transcripts and creating meaningful question-answer pairs.
  Please analyze this podcast transcript and create Q&A pairs that capture important information and insights.
  
  Here's the full transcript:
  ${transcript
    .map(
      (segment) =>
        `${segment.labeledSpeaker} (${segment.timestampFrom}-${segment.timestampTo}): ${segment.content}`
    )
    .join("\n")}
  
  For each Q&A pair:
  - The question should be natural and conversational
  - The answer should be a direct response to the question
  - Questions and answers can come from different speakers
  - Include the timestamps for both the question and answer
  - Focus on extracting valuable information and insights
  
  IMPORTANT: Return ONLY a JSON array of Q&A pairs with the following structure:
  {
    "question": "string",
    "answer": "string",
    "questionSpeaker": "string",
    "answerSpeaker": "string",
    "timestampFrom": "string",
    "timestampTo": "string"
  }`;

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-pro-exp-03-25",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              answer: { type: Type.STRING },
              questionSpeaker: { type: Type.STRING },
              answerSpeaker: { type: Type.STRING },
              timestampFrom: { type: Type.STRING },
              timestampTo: { type: Type.STRING },
            },
            required: [
              "question",
              "answer",
              "questionSpeaker",
              "answerSpeaker",
              "timestampFrom",
              "timestampTo",
            ],
          },
        },
      },
    });

    if (!response.text) {
      throw new Error("No response text received from Gemini");
    }

    return JSON.parse(response.text) as QAPair[];
  } catch (error) {
    console.error("Error generating Q&A pairs:", error);
    return [];
  }
}

async function saveQAPairs(
  directory: string,
  transcriptFile: string,
  qaPairs: QAPair[]
) {
  // Extract the base name without _transcript_labeled.json
  const baseName = transcriptFile.replace("_transcript_labeled.json", "");
  const qaPairsPath = path.join(directory, `${baseName}_qa_pairs.json`);
  fs.writeFileSync(qaPairsPath, JSON.stringify(qaPairs, null, 2));
  console.log(`Q&A pairs saved to: ${qaPairsPath}`);
}

async function findLabeledTranscriptFile(
  dataDir: string
): Promise<{ transcriptFile: string; directory: string } | null> {
  try {
    // Recursively search for labeled transcript files
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
        } else if (file.endsWith("_transcript_labeled.json")) {
          // Check if Q&A pairs already exist
          const qaFile = file.replace(
            "_transcript_labeled.json",
            "_qa_pairs.json"
          );
          const qaPath = path.join(dir, qaFile);

          if (!fs.existsSync(qaPath)) {
            return { transcriptFile: file, directory: dir };
          } else {
            console.log(
              `Skipping ${file} - Q&A pairs already generated at ${qaPath}`
            );
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

    // Find the labeled transcript file
    const result = await findLabeledTranscriptFile(dataDir);
    if (!result) {
      console.log("No labeled transcript file found in data directory");
      return;
    }

    const { transcriptFile, directory } = result;
    console.log(`Found transcript: ${transcriptFile} in ${directory}`);

    const transcript = await loadLabeledTranscript(directory, transcriptFile);
    if (transcript.length === 0) {
      console.error(`Empty transcript for ${transcriptFile}`);
      return;
    }

    try {
      const qaPairs = await generateQAPairs(transcript);
      if (qaPairs.length > 0) {
        await saveQAPairs(directory, transcriptFile, qaPairs);
        console.log(`Generated ${qaPairs.length} Q&A pairs successfully`);
      } else {
        console.error("No Q&A pairs were generated");
      }
    } catch (error) {
      console.error(
        `Failed to generate Q&A pairs for ${transcriptFile}:`,
        error
      );
      // Create a failed.txt file to track failed Q&A generation attempts
      const failedPath = path.join(directory, "failed_qa_generation.txt");
      fs.appendFileSync(failedPath, `${transcriptFile}\n`);
    }
  } catch (error) {
    console.error("Main process failed:", error);
  }
}

main();
