using System.Text.Json;
using SummitCheckIn.Web;

IReadOnlyList<IReadOnlyList<JsonElement>> Rows(string[][] rows) => rows
    .Select(row => (IReadOnlyList<JsonElement>)row.Select(value => JsonSerializer.SerializeToElement(value)).ToArray()).ToArray();
var lists = Rows([
    ["Family Name", "Member Name", " Type "],
    ["A", "Sam", " Parent "], ["A", "Alex", "parent"], ["A", "Child", "Student"],
    ["B", "Sam", "PARENT"], ["A", "Sam", "Parent"]
]);
var records = Rows([
    ["CheckInID", "Timestamp", "Family Name", "Member Present", "Notes"],
    ["2026-09-03|A", "", "A", "Sam", ""],
    ["2026-09-03|A", "", "A", "Sam", ""],
    ["2026-09-10|A", "", "A", "Child", ""],
    ["2026-09-17|A", "", "A", "", ""],
    ["2026-09-18|A", "", "A", "Alex", ""],
    ["2026-08-27|A", "", "A", "Alex", ""],
    ["2027-06-03|A", "", "A", "Alex", ""],
    ["2027-01-07|B", "", "B", "Sam", ""]
]);
void Check(bool condition, string label) { if (!condition) throw new Exception(label); }
var report = GoogleSheetsAttendanceStore.BuildParentReport(lists, records);
Check(report.TotalThursdays == 6, "All recorded Thursdays, across years and outside September-May");
Check(report.Parents.Count == 3, "Parents only, no duplicate roster entries");
Check(report.Parents.Single(p => p.Family == "A" && p.Name == "Sam").Percent == 17, "Unique parent days and rounding");
Check(report.Parents.Single(p => p.Name == "Alex").Percent == 33, "Attendance outside September-May is included");
Check(report.Parents.Single(p => p.Family == "B").Percent == 17, "Same name in another family counted separately");
var empty = GoogleSheetsAttendanceStore.BuildParentReport(lists, records.Take(1).ToArray());
Check(empty.TotalThursdays == 0 && empty.Parents.Count == 3 && empty.Parents.All(p => p.Percent == 0), "Empty sheet includes all parents without dividing by zero");
var missingType = GoogleSheetsAttendanceStore.BuildParentReport(Rows([["Family Name", "Member Name"]]), records);
Check(missingType.Message != null, "Missing type is explained");
Console.WriteLine("Parent attendance checks passed.");
