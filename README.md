# musclenerds

A tool for downloading, transcribing, and analyzing podcast episodes featuring Luke Leaman.

## Features

- Downloads podcast metadata and audio files from Podcast Index API
- Transcribes audio using Replicate's Whisper Diarization model
- Labels speakers using Google's Gemini AI
- Organizes content in a structured data directory

## Setup

1. Create a `.env` file with your API keys:

```
PODCAST_INDEX_API_KEY=your_key
PODCAST_INDEX_API_SECRET=your_secret
REPLICATE_API_KEY=your_key
GEMINI_API_KEY=your_key
```

2. Install dependencies:

```bash
bun install
```

## Usage

1. Download podcast episodes and metadata:

```bash
bun run download-metadata.ts
```

2. Transcribe episodes:

```bash
bun run transcribe.ts
```

3. Label speakers:

```bash
bun run label-speakers.ts
```

This project was created using `bun init` in bun v1.1.16. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
