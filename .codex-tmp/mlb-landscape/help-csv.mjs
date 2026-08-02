import { Workbook } from "@oai/artifact-tool";

const workbook = Workbook.create();
workbook.worksheets.add("Import");
console.log(workbook.help("csv export", {
  include: "index,examples,notes",
  maxChars: 5000,
}).ndjson);
