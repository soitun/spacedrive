/*
  Warnings:

  - You are about to drop the column `local_path` on the `location` table. All the data in the column will be lost.
  - You are about to drop the column `date_indexed` on the `object` table. All the data in the column will be lost.
  - You are about to drop the column `date_modified` on the `object` table. All the data in the column will be lost.
  - You are about to drop the column `extension` on the `object` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `object` table. All the data in the column will be lost.
  - You are about to drop the column `size_in_bytes` on the `object` table. All the data in the column will be lost.
  - Added the required column `path` to the `location` table without a default value. This is not possible if the table is not empty.
  - Made the column `name` on table `location` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_location" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pub_id" BLOB NOT NULL,
    "node_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "total_capacity" INTEGER,
    "available_capacity" INTEGER,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "generate_preview_media" BOOLEAN NOT NULL DEFAULT true,
    "sync_preview_media" BOOLEAN NOT NULL DEFAULT true,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "date_created" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "location_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "node" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_location" ("available_capacity", "date_created", "generate_preview_media", "hidden", "id", "is_archived", "name", "node_id", "pub_id", "sync_preview_media", "total_capacity") SELECT "available_capacity", "date_created", "generate_preview_media", "hidden", "id", "is_archived", "name", "node_id", "pub_id", "sync_preview_media", "total_capacity" FROM "location";
DROP TABLE "location";
ALTER TABLE "new_location" RENAME TO "location";
CREATE UNIQUE INDEX "location_pub_id_key" ON "location"("pub_id");
CREATE TABLE "new_object" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pub_id" BLOB NOT NULL,
    "kind" INTEGER NOT NULL DEFAULT 0,
    "key_id" INTEGER,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "has_thumbnail" BOOLEAN NOT NULL DEFAULT false,
    "has_thumbstrip" BOOLEAN NOT NULL DEFAULT false,
    "has_video_preview" BOOLEAN NOT NULL DEFAULT false,
    "ipfs_id" TEXT,
    "note" TEXT,
    "date_created" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "object_key_id_fkey" FOREIGN KEY ("key_id") REFERENCES "key" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_object" ("date_created", "favorite", "has_thumbnail", "has_thumbstrip", "has_video_preview", "hidden", "id", "important", "ipfs_id", "key_id", "kind", "note", "pub_id") SELECT "date_created", "favorite", "has_thumbnail", "has_thumbstrip", "has_video_preview", "hidden", "id", "important", "ipfs_id", "key_id", "kind", "note", "pub_id" FROM "object";
DROP TABLE "object";
ALTER TABLE "new_object" RENAME TO "object";
CREATE UNIQUE INDEX "object_pub_id_key" ON "object"("pub_id");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
