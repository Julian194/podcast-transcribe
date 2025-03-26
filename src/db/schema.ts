import {
  integer,
  pgTable,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

export const episodesTable = pgTable("episodes", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  externalId: varchar({ length: 255 }).notNull().unique(), // e.g. "15915208644"
  title: varchar({ length: 255 }).notNull(),
  description: text(),
  link: varchar({ length: 255 }),
  guid: varchar({ length: 255 }),
  datePublished: timestamp(),
  dateCrawled: timestamp(),
  enclosureUrl: varchar({ length: 255 }),
  enclosureType: varchar({ length: 50 }),
  enclosureLength: integer(),
  duration: integer(), // in seconds
  explicit: boolean(),
  episode: integer(),
  episodeType: varchar({ length: 50 }),
  season: integer(),
  image: varchar({ length: 255 }),
  feedItunesId: integer(),
  feedImage: varchar({ length: 255 }),
  feedId: integer(),
  feedUrl: varchar({ length: 255 }),
  feedAuthor: varchar({ length: 255 }),
  feedTitle: varchar({ length: 255 }),
  feedLanguage: varchar({ length: 10 }),
  chaptersUrl: varchar({ length: 255 }),
  transcriptUrl: varchar({ length: 255 }),
  metadata: jsonb(), // For any additional fields we might want to store
});

export const episodeTimestampsTable = pgTable("episode_timestamps", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  episodeId: integer().references(() => episodesTable.id),
  speaker: varchar({ length: 255 }).notNull(),
  labeledSpeaker: varchar({ length: 255 }),
  timestampFrom: varchar({ length: 10 }).notNull(), // Format: "MM:SS"
  timestampTo: varchar({ length: 10 }).notNull(), // Format: "MM:SS"
  content: text().notNull(),
});
