// Taxon-name matching rules used to link tanglegram tips.
const assert = require("node:assert/strict");
global.Tree = require("../src/core.js");
const Tangle = require("../src/tangle.js");

const cases = [
  ["Gilliamella apicola wkB72 Locus1", "Gilliamella_apicola_wkB72", "strain", true],
  ["Gilliamella sp B3801 Locus2", "Gilliamella sp. B3801", "strain", true],
  ["Gilliamella sp B3801 Locus2", "Gilliamella sp. B3817", "strain", false],
  ["Gilliamella apicola Occ3-1 Locus1", "G. apicola Occ3_1", "strain", true],
  ["Escherichia coli str. K-12 substr. MG1655", "Escherichia coli K-12", "strain", true],
  ["Escherichia coli O157:H7 str. Sakai", "Escherichia coli Sakai", "strain", false],
  ["Salmonella enterica subsp. enterica LT2", "Salmonella enterica subsp. enterica LT2 geneX", "strain", true],
  ["Bombus terrestris strain B1", "Bombus terrestris B1", "strain", true],
  ["Apis mellifera", "Apis mellifera", "strain", true],
  ["Apis mellifera", "Apis cerana", "strain", false],
  ["NZ_CP012345", "NZ_CP012345", "strain", true],
  ["Apis mellifera worker 3", "Apis mellifera", "species", true],
  ["Gilliamella sp B3801", "Gilliamella sp B3817", "species", false],
  ["Apis_mellifera", "apis mellifera", "exact", true],
];
let failed = 0;
for (const [a, b, mode, want] of cases) {
  const got = Tangle.same(Tangle.nameKey(a), Tangle.nameKey(b), mode);
  try { assert.equal(got, want); console.log("ok  ", `${a} | ${b} (${mode})`); }
  catch { failed++; console.error("FAIL", `${a} | ${b} (${mode}) -> ${got}`); }
}
if (failed) process.exitCode = 1;
console.log(`\n${cases.length - failed} of ${cases.length} passed`);
