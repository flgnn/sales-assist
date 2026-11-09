const { susScore, analyze: sus } = require("../scripts/sus-score");
const { analyze: timeA } = require("../scripts/time-analysis");

test("SUS: contoh baku", () => {
  expect(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
  expect(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
  expect(susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toBe(50);
  expect(() => susScore([1, 2])).toThrow();
  expect(() => susScore([9, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toThrow();
  const csv = "responden,q1,q2,q3,q4,q5,q6,q7,q8,q9,q10\n" + Array.from({ length: 10 }, (_, i) => `R${i},4,2,4,2,4,2,4,2,4,2`).join("\n");
  const r = sus(csv);
  expect(r).toMatchObject({ n: 10, mean: 75, meets_target: true });
  expect(sus(csv.split("\n").slice(0, 4).join("\n")).meets_target).toBe(false); // < 10 responden
});

test("analisis waktu: penurunan % dan syarat minimal 10 skenario", () => {
  const csv = "skenario,manual_detik,sistem_detik\n" + Array.from({ length: 10 }, (_, i) => `S${i},600,300`).join("\n");
  expect(timeA(csv)).toMatchObject({ n: 10, rata2_turun_pct: 50, total_turun_pct: 50, meets_target: true });
  expect(timeA("skenario,manual_detik,sistem_detik\nA,100,90").meets_target).toBe(false);
  expect(() => timeA("h\nA,0,1")).toThrow();
});
