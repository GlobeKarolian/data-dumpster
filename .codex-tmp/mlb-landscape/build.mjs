import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir =
  "/Users/mkarolian/Developer/pressbox/outputs/019fb5a1-fda5-76f3-bd6e-a7fcbb5a0ea4";

const headers = [
  "company_name",
  "company_url",
  "is_focus",
  "segment",
  "color",
  "facebook",
  "instagram",
  "threads",
  "x",
  "youtube",
  "tiktok",
  "bluesky",
  "reddit",
  "linkedin",
];

const teams = [
  {
    name: "Arizona Diamondbacks",
    slug: "dbacks",
    division: "NL West",
    color: "#A71930",
    x: "Dbacks",
    instagram: "dbacks",
    facebook: "Dbacks",
    tiktok: "dbacks",
    youtube: "dbacks",
    threads: "dbacks",
    reddit: "https://www.reddit.com/r/azdiamondbacks/",
    linkedin: "https://www.linkedin.com/company/arizona-diamondbacks",
  },
  {
    name: "Athletics",
    slug: "athletics",
    division: "AL West",
    color: "#003831",
    x: "Athletics",
    instagram: "athletics",
    facebook: "Athletics",
    tiktok: "athletics",
    youtube: "athletics",
    threads: "athletics",
    linkedin: "https://www.linkedin.com/company/the-athletics",
  },
  {
    name: "Atlanta Braves",
    slug: "braves",
    division: "NL East",
    color: "#CE1141",
    x: "Braves",
    instagram: "braves",
    facebook: "Braves",
    tiktok: "braves",
    youtube: "braves",
    threads: "braves",
    reddit: "https://www.reddit.com/r/Braves/",
    linkedin: "https://www.linkedin.com/company/atlanta-braves",
  },
  {
    name: "Baltimore Orioles",
    slug: "orioles",
    division: "AL East",
    color: "#DF4601",
    x: "Orioles",
    instagram: "orioles",
    facebook: "Orioles",
    tiktok: "orioles",
    youtube: "orioles",
    threads: "orioles",
    reddit: "https://www.reddit.com/r/orioles/",
    linkedin: "https://www.linkedin.com/company/baltimore-orioles",
  },
  {
    name: "Boston Red Sox",
    slug: "redsox",
    division: "AL East",
    color: "#BD3039",
    x: "RedSox",
    instagram: "redsox",
    facebook: "RedSox",
    tiktok: "redsox",
    youtube: "redsox",
    threads: "redsox",
    bluesky: "redsox.com",
  },
  {
    name: "Chicago Cubs",
    slug: "cubs",
    division: "NL Central",
    color: "#0E3386",
    x: "Cubs",
    instagram: "cubs",
    facebook: "Cubs",
    tiktok: "cubs",
    youtube: "cubs",
    threads: "cubs",
  },
  {
    name: "Chicago White Sox",
    slug: "whitesox",
    division: "AL Central",
    color: "#27251F",
    x: "WhiteSox",
    instagram: "whitesox",
    facebook: "WhiteSox",
    tiktok: "whitesox",
    youtube: "whitesox",
    threads: "whitesox",
    linkedin: "https://www.linkedin.com/company/chicago-white-sox",
  },
  {
    name: "Cincinnati Reds",
    slug: "reds",
    division: "NL Central",
    color: "#C6011F",
    x: "Reds",
    instagram: "reds",
    facebook: "Reds",
    tiktok: "reds",
    youtube: "reds",
    reddit: "https://www.reddit.com/r/Reds/",
  },
  {
    name: "Cleveland Guardians",
    slug: "guardians",
    division: "AL Central",
    color: "#00385D",
    x: "CleGuardians",
    instagram: "cleguardians",
    facebook: "CleGuardians",
    tiktok: "cleguardians",
    youtube: "cleguardians",
    threads: "cleguardians",
    linkedin: "https://www.linkedin.com/company/cleguardians",
  },
  {
    name: "Colorado Rockies",
    slug: "rockies",
    division: "NL West",
    color: "#333366",
    x: "Rockies",
    instagram: "rockies",
    facebook: "Rockies",
    tiktok: "rockies",
    youtube: "rockies",
  },
  {
    name: "Detroit Tigers",
    slug: "tigers",
    division: "AL Central",
    color: "#0C2340",
    x: "Tigers",
    instagram: "tigers",
    facebook: "Tigers",
    tiktok: "tigers",
    youtube: "tigers",
    threads: "tigers",
    linkedin: "https://www.linkedin.com/company/detroit-tigers",
  },
  {
    name: "Houston Astros",
    slug: "astros",
    division: "AL West",
    color: "#002D62",
    x: "Astros",
    instagram: "astros",
    facebook: "Astros",
    tiktok: "astros",
    youtube: "astros",
    threads: "astros",
    linkedin: "https://www.linkedin.com/company/houston-astros",
  },
  {
    name: "Kansas City Royals",
    slug: "royals",
    division: "AL Central",
    color: "#004687",
    x: "Royals",
    instagram: "royals",
    facebook: "Royals",
    tiktok: "royals",
    youtube: "royals",
    threads: "kcroyals",
    bluesky: "royals.com",
    linkedin: "https://www.linkedin.com/company/kansas-city-royals",
  },
  {
    name: "Los Angeles Angels",
    slug: "angels",
    division: "AL West",
    color: "#BA0021",
    x: "Angels",
    instagram: "angels",
    facebook: "Angels",
    tiktok: "angels",
    youtube: "angels",
    threads: "angels",
    linkedin: "https://www.linkedin.com/company/angels-baseball",
  },
  {
    name: "Los Angeles Dodgers",
    slug: "dodgers",
    division: "NL West",
    color: "#005A9C",
    x: "Dodgers",
    instagram: "dodgers",
    facebook: "Dodgers",
    tiktok: "dodgers",
    youtube: "dodgers",
    threads: "dodgers",
    linkedin: "https://www.linkedin.com/company/los-angeles-dodgers",
  },
  {
    name: "Miami Marlins",
    slug: "marlins",
    division: "NL East",
    color: "#00A3E0",
    x: "Marlins",
    instagram: "marlins",
    facebook: "Marlins",
    tiktok: "marlins",
    youtube: "marlins",
    threads: "marlins",
    linkedin: "https://www.linkedin.com/company/miami-marlins-l-p-",
  },
  {
    name: "Milwaukee Brewers",
    slug: "brewers",
    division: "NL Central",
    color: "#12284B",
    x: "Brewers",
    instagram: "brewers",
    facebook: "Brewers",
    tiktok: "brewers",
    youtube: "brewers",
    threads: "brewers",
    linkedin: "https://www.linkedin.com/company/milwaukee-brewers-baseball-club",
  },
  {
    name: "Minnesota Twins",
    slug: "twins",
    division: "AL Central",
    color: "#002B5C",
    x: "Twins",
    instagram: "twins",
    facebook: "Twins",
    tiktok: "twins",
    youtube: "twins",
    threads: "twins",
    linkedin: "https://www.linkedin.com/company/minnesota-twins",
  },
  {
    name: "New York Mets",
    slug: "mets",
    division: "NL East",
    color: "#002D72",
    x: "Mets",
    instagram: "mets",
    facebook: "Mets",
    tiktok: "mets",
    youtube: "mets",
    threads: "mets",
    linkedin: "https://www.linkedin.com/company/new-york-mets",
  },
  {
    name: "New York Yankees",
    slug: "yankees",
    division: "AL East",
    color: "#0C2340",
    x: "Yankees",
    instagram: "yankees",
    facebook: "Yankees",
    tiktok: "yankees",
    youtube: "yankees",
    threads: "yankees",
    linkedin: "https://www.linkedin.com/company/new-york-yankees",
  },
  {
    name: "Philadelphia Phillies",
    slug: "phillies",
    division: "NL East",
    color: "#E81828",
    x: "Phillies",
    instagram: "phillies",
    facebook: "Phillies",
    tiktok: "phillies",
    youtube: "phillies",
    threads: "phillies",
    linkedin: "https://www.linkedin.com/company/philadelphia-phillies",
  },
  {
    name: "Pittsburgh Pirates",
    slug: "pirates",
    division: "NL Central",
    color: "#FDB827",
    x: "Pirates",
    instagram: "pirates",
    facebook: "Pirates",
    tiktok: "pirates",
    youtube: "pirates",
    threads: "pittsburghpirates",
    linkedin: "https://www.linkedin.com/company/pittsburgh-pirates",
  },
  {
    name: "San Diego Padres",
    slug: "padres",
    division: "NL West",
    color: "#2F241D",
    x: "Padres",
    instagram: "padres",
    facebook: "Padres",
    tiktok: "padres",
    youtube: "padres",
    threads: "padres",
    reddit: "https://www.reddit.com/r/Padres/",
    linkedin: "https://www.linkedin.com/company/sandiegopadres",
  },
  {
    name: "San Francisco Giants",
    slug: "giants",
    division: "NL West",
    color: "#FD5A1E",
    x: "SFGiants",
    instagram: "sfgiants",
    facebook: "SFGiants",
    tiktok: "sfgiants",
    youtube: "sfgiants",
    threads: "sfgiants",
    reddit: "https://www.reddit.com/r/SFGiants/",
    linkedin: "https://www.linkedin.com/company/san-francisco-giants",
  },
  {
    name: "Seattle Mariners",
    slug: "mariners",
    division: "AL West",
    color: "#0C2C56",
    x: "Mariners",
    instagram: "mariners",
    facebook: "Mariners",
    tiktok: "mariners",
    youtube: "mariners",
    threads: "mariners",
    linkedin: "https://www.linkedin.com/company/seattle-mariners",
  },
  {
    name: "St. Louis Cardinals",
    slug: "cardinals",
    division: "NL Central",
    color: "#C41E3A",
    x: "Cardinals",
    instagram: "cardinals",
    facebook: "Cardinals",
    tiktok: "cardinals",
    youtube: "cardinals",
    threads: "cardinals",
  },
  {
    name: "Tampa Bay Rays",
    slug: "rays",
    division: "AL East",
    color: "#092C5C",
    x: "RaysBaseball",
    instagram: "raysbaseball",
    facebook: "RaysBaseball",
    tiktok: "raysbaseball",
    youtube: "raysbaseball",
    threads: "raysbaseball",
    linkedin: "https://www.linkedin.com/company/tampa-bay-rays",
  },
  {
    name: "Texas Rangers",
    slug: "rangers",
    division: "AL West",
    color: "#003278",
    x: "Rangers",
    instagram: "rangers",
    facebook: "Rangers",
    tiktok: "rangers",
    youtube: "rangers",
  },
  {
    name: "Toronto Blue Jays",
    slug: "bluejays",
    division: "AL East",
    color: "#134A8E",
    x: "BlueJays",
    instagram: "bluejays",
    facebook: "BlueJays",
    tiktok: "bluejays",
    youtube: "bluejays",
    threads: "bluejays",
    linkedin: "https://www.linkedin.com/company/toronto-blue-jays",
  },
  {
    name: "Washington Nationals",
    slug: "nationals",
    division: "NL East",
    color: "#AB0003",
    x: "Nationals",
    instagram: "nationals",
    facebook: "Nationals",
    tiktok: "nationals",
    youtube: "nationals",
    threads: "nationals",
    bluesky: "nationals.com",
  },
];

function url(value) {
  return value || "";
}

function rowFor(team) {
  return [
    team.name,
    `https://www.mlb.com/${team.slug}`,
    team.name === "Boston Red Sox" ? "yes" : "no",
    team.division,
    team.color,
    `https://www.facebook.com/${team.facebook}`,
    `https://www.instagram.com/${team.instagram}`,
    team.threads ? `https://www.threads.com/@${team.threads}` : "",
    `https://x.com/${team.x}`,
    `https://www.youtube.com/@${team.youtube}`,
    `https://www.tiktok.com/@${team.tiktok}`,
    team.bluesky ? `https://bsky.app/profile/${team.bluesky}` : "",
    url(team.reddit),
    url(team.linkedin),
  ];
}

function csvCell(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

const importRows = [headers, ...teams.map(rowFor)];
const csv =
  "\uFEFF" + importRows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";

const workbook = Workbook.create();
const importSheet = workbook.worksheets.add("Import");
importSheet.getRange(`A1:N${importRows.length}`).values = importRows;
importSheet.showGridLines = false;
importSheet.freezePanes.freezeRows(1);

importSheet.getRange("A1:N1").format = {
  fill: "#0C2340",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  borders: {
    bottom: { style: "medium", color: "#BD3039" },
  },
};
importSheet.getRange("A1:N1").format.rowHeight = 30;
importSheet.getRange("A2:N31").format = {
  font: { color: "#18181B" },
  verticalAlignment: "center",
  borders: {
    insideHorizontal: { style: "thin", color: "#E4E4E7" },
  },
};
importSheet.getRange("A2:A31").format.font = { bold: true, color: "#18181B" };
importSheet.getRange("B2:B31").format.wrapText = true;
importSheet.getRange("F2:N31").format.wrapText = true;
importSheet.getRange("C2:E31").format.horizontalAlignment = "center";
importSheet.getRange("A2:N31").format.rowHeight = 44;
importSheet.getRange("A1:A31").format.columnWidth = 24;
importSheet.getRange("B1:B31").format.columnWidth = 28;
importSheet.getRange("C1:C31").format.columnWidth = 10;
importSheet.getRange("D1:D31").format.columnWidth = 12;
importSheet.getRange("E1:E31").format.columnWidth = 11;
importSheet.getRange("F1:N31").format.columnWidth = 28;
importSheet.getRange("C2:C31").conditionalFormats.add("containsText", {
  text: "yes",
  format: {
    fill: "#FCE7EA",
    font: { bold: true, color: "#9F1239" },
  },
});
const importTable = importSheet.tables.add("A1:N31", true, "MlbLandscapeImport");
importTable.style = "TableStyleMedium2";
importTable.showFilterButton = true;

const sourcesSheet = workbook.worksheets.add("Sources");
const sourceHeaders = ["team", "profile_source", "color_source", "notes"];
const sourceRows = teams.map((team) => [
  team.name,
  `https://www.mlb.com/${team.slug}/social`,
  "https://teamcolorcodes.com/mlb-color-codes/",
  "Core X, Instagram, Facebook, TikTok, and YouTube URLs supplied by the user; extra profiles included only when MLB exposed them on a team page.",
]);
sourcesSheet.getRange("A1:D31").values = [sourceHeaders, ...sourceRows];
sourcesSheet.showGridLines = false;
sourcesSheet.freezePanes.freezeRows(1);
sourcesSheet.getRange("A1:D1").format = {
  fill: "#0C2340",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: {
    bottom: { style: "medium", color: "#BD3039" },
  },
};
sourcesSheet.getRange("A1:D1").format.rowHeight = 30;
sourcesSheet.getRange("A2:D31").format = {
  font: { color: "#18181B" },
  verticalAlignment: "top",
  wrapText: true,
  borders: {
    insideHorizontal: { style: "thin", color: "#E4E4E7" },
  },
};
sourcesSheet.getRange("A2:A31").format.font = { bold: true, color: "#18181B" };
sourcesSheet.getRange("A1:A31").format.columnWidth = 24;
sourcesSheet.getRange("B1:B31").format.columnWidth = 42;
sourcesSheet.getRange("C1:C31").format.columnWidth = 42;
sourcesSheet.getRange("D1:D31").format.columnWidth = 64;
sourcesSheet.getRange("A2:D31").format.rowHeight = 34;
const sourcesTable = sourcesSheet.tables.add("A1:D31", true, "MlbLandscapeSources");
sourcesTable.style = "TableStyleMedium2";
sourcesTable.showFilterButton = true;

const importCheck = await workbook.inspect({
  kind: "table",
  range: "Import!A1:N31",
  include: "values,formulas",
  tableMaxRows: 6,
  tableMaxCols: 14,
  maxChars: 8000,
});
console.log(importCheck.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(`${outputDir}/mlb-landscape-import.csv`, csv, "utf8");

const importPreview = await workbook.render({
  sheetName: "Import",
  range: "A1:N31",
  scale: 1,
  format: "png",
});
await fs.writeFile(
  `${outputDir}/mlb-landscape-import-preview.png`,
  new Uint8Array(await importPreview.arrayBuffer()),
);

const sourcesPreview = await workbook.render({
  sheetName: "Sources",
  range: "A1:D31",
  scale: 1,
  format: "png",
});
await fs.writeFile(
  `${outputDir}/mlb-landscape-sources-preview.png`,
  new Uint8Array(await sourcesPreview.arrayBuffer()),
);

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(`${outputDir}/mlb-landscape-import.xlsx`);

console.log(JSON.stringify({
  teams: teams.length,
  focus: teams.filter((team) => team.name === "Boston Red Sox").length,
  csv: `${outputDir}/mlb-landscape-import.csv`,
  xlsx: `${outputDir}/mlb-landscape-import.xlsx`,
}));
