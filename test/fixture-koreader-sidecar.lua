-- Provenance: serialized by KOReader's own frontend/dump.lua (ordered mode,
-- via ffi/util.orderedPairs) and wrapped exactly as util.writeToFile does with
-- lua_dofile_ready. The annotation TEXT is real Pride and Prejudice prose; the
-- xpointers are crengine-shaped and deliberately do NOT resolve against a
-- browser DOM, which is the seam this fixture exists to exercise. Entry 4 is a
-- deliberate miss: its text appears nowhere in the book.
-- /library/Pride and Prejudice.sdr/metadata.epub.lua
return {
    ["annotations"] = {
        [1] = {
            ["chapter"] = "CHAPTER I.",
            ["color"] = "yellow",
            ["datetime"] = "2026-09-12 21:04:11",
            ["drawer"] = "lighten",
            ["note"] = "The novel states its economics in the second paragraph.",
            ["page"] = "/body/DocFragment[3]/body/div/p[2]/text().0",
            ["pageno"] = 12,
            ["pos0"] = "/body/DocFragment[3]/body/div/p[2]/text().0",
            ["pos1"] = "/body/DocFragment[3]/body/div/p[2]/text().59",
            ["text"] = "A single man of large fortune; four or five thousand a year.",
        },
        [2] = {
            ["chapter"] = "CHAPTER VII.",
            ["color"] = "blue",
            ["datetime"] = "2026-09-13 07:41:52",
            ["drawer"] = "underscore",
            ["page"] = "/body/DocFragment[4]/body/div/p[18]/text().0",
            ["pageno"] = 63,
            ["pos0"] = "/body/DocFragment[4]/body/div/p[18]/text().0",
            ["pos1"] = "/body/DocFragment[4]/body/div/p[18]/text().84",
            ["text"] = "She did at last extort from her father an acknowledgment that the horses were engaged",
        },
        [3] = {
            ["chapter"] = "CHAPTER X.",
            ["color"] = "orange",
            ["datetime"] = "2026-09-14 19:22:08",
            ["drawer"] = "lighten",
            ["note"] = "Three people, a path for two.\
The whole book in one line of blocking.",
            ["page"] = "/body/DocFragment[5]/body/div/p[41]/text().12",
            ["pageno"] = 141,
            ["pos0"] = "/body/DocFragment[5]/body/div/p[41]/text().12",
            ["pos1"] = "/body/DocFragment[5]/body/div/p[41]/text().41",
            ["text"] = "The path just admitted three.",
        },
        [4] = {
            ["chapter"] = "CHAPTER XII.",
            ["color"] = "yellow",
            ["datetime"] = "2026-09-15 08:03:19",
            ["drawer"] = "lighten",
            ["page"] = "/body/DocFragment[6]/body/div/p[7]/text().0",
            ["pageno"] = 190,
            ["pos0"] = "/body/DocFragment[6]/body/div/p[7]/text().0",
            ["pos1"] = "/body/DocFragment[6]/body/div/p[7]/text().54",
            ["text"] = "This sentence is not anywhere in Pride and Prejudice.",
        },
    },
    ["cre_dom_version"] = 20240114,
    ["doc_pages"] = 611,
    ["doc_props"] = {
        ["authors"] = "Jane Austen",
        ["language"] = "en",
        ["title"] = "Pride and Prejudice",
    },
    ["partial_md5_checksum"] = "9f2e4c1b77a0d3e58c6b41af0d92ee37",
    ["percent_finished"] = 0.2913,
    ["stats"] = {
        ["authors"] = "Jane Austen",
        ["pages"] = 611,
        ["performance_in_pages"] = {},
        ["title"] = "Pride and Prejudice",
    },
    ["summary"] = {
        ["modified"] = "2026-09-14",
        ["status"] = "reading",
    },
}
