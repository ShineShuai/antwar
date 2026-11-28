# The project file

A share link (`#v1.…`, `web/share.ts`) carries one match. The **project file** carries the whole workshop: the brains, the seed, the Rules, the map and the
version histories, in one JSON file you can keep, send or open on another machine. The workshop's **Export project** and **Import project…** buttons
(next to *Copy link*) write and read it; the code is `web/projectfile.ts` (pure, no DOM or storage) and `web/versions.ts` (`mergeVersions`).

```json
{ "format": "antwar-project", "version": 1, "seed": 9, "rules": "altorder",
  "generator": 2,                              // only for the contest world, which has no map text
  "brains": ["# personality: …", "…"],         // 2 to 26 texts, one per colony, in order
  "world": { "kind": "fair3", "map": "…" },    // kind as the example-world picker has it; map is empty only for kind ""
  "versions": { "A": [ { "t": 1700000000000, "text": "…", "label": "run" } ] } }
```

**Export** takes the editors as they are now, the seed box, the Rules and the map in the page, and the saved version histories. A seed that is not a whole
number from 0 to 1,073,741,823 is refused (it could not be opened again). Which colonies are in a match is the number of `brains`; the world kind `""` (the contest
generator's world of the seed) names the world generator that made it, because another generator makes another map; every other kind stores its map text.

**Import** reads the file strictly (`parseProjectFile`): anything that is wrong is refused with the reason and **nothing changes**. Limits: 8 MiB for the
file, 2 to 26 brains of at most 131,072 characters each, a map of at most 131,072 characters, a known Rules name (the old name `colonies` opens as `classic`),
histories only for slots A to Z, 30 versions a slot (the newest), 2 MiB in all. Unknown fields are ignored; a newer `version` is refused with a request to
update. A good file then: keeps the brains it replaces as a version each ("before importing a project"), merges the file's histories into the saved ones (a version
with the same time and text is not added twice), sets the editors, seed, Rules and map, and starts the match. A contest world made by another generator
is flagged: the map may differ. The file is data, not code: nothing in it runs until you run a match with its brains, as with any brain you paste.

Not in the file: the Arena's and the Maps page's own settings (the Arena reads the workshop's project; the map designer's draft and library are separate), and the
replay (a share link has that).
