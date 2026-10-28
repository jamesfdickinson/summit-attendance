using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Caching.Memory;

namespace SummitCheckIn.Web;

public sealed class GoogleSheetsAttendanceStore(
    IConfiguration configuration,
    IHttpClientFactory clients,
    GoogleTokenProvider tokens,
    IMemoryCache cache)
{
    private const string VisitorFamily = "Visitor";
    private const int MaxNotesLength = 500;
    private const int MaxVisitors = 25;
    private static readonly string[] CheckInHeaders =
        ["CheckInID", "Timestamp", "Family Name", "Member Present", "Notes"];
    private readonly SemaphoreSlim _writeGate = new(1, 1);

    public async Task<IReadOnlyList<FamilyDto>> GetFamiliesAsync(CancellationToken cancellationToken)
    {
        if (cache.TryGetValue("families-v1", out IReadOnlyList<FamilyDto>? cached) && cached is not null)
            return cached;

        var rows = await GetValuesAsync("Lists", cancellationToken);
        if (rows.Count == 0) throw SheetFailure("The Lists sheet has no headers.");
        var headers = HeaderMap(rows[0], "Lists", ["Family Name", "Member Name"]);
        var families = new Dictionary<string, List<string>>(StringComparer.Ordinal);

        foreach (var row in rows.Skip(1))
        {
            var family = CellText(row, headers["Family Name"]).Trim();
            var member = CellText(row, headers["Member Name"]).Trim();
            if (family.Length == 0 || member.Length == 0) continue;
            if (!families.TryGetValue(family, out var members))
                families[family] = members = [];
            if (!members.Contains(member, StringComparer.Ordinal)) members.Add(member);
        }

        var result = families
            .OrderBy(pair => pair.Key, StringComparer.CurrentCulture)
            .Select(pair => new FamilyDto(pair.Key, pair.Value))
            .ToArray();
        cache.Set("families-v1", result, TimeSpan.FromMinutes(5));
        return result;
    }

    public async Task<SaveResult> SaveAsync(CheckInRequest request, CancellationToken cancellationToken)
    {
        var family = Clean(request.Family, 150, "Family name");
        var notes = Clean(request.Notes ?? "", MaxNotesLength, "Notes", allowEmpty: true);
        if (request.Members is null) throw ValidationFailure("Members are invalid.");

        var families = await GetFamiliesAsync(cancellationToken);
        var familyEntry = families.FirstOrDefault(item => item.Name == family);
        var isVisitor = family == VisitorFamily;
        if (!isVisitor && familyEntry is null) throw ValidationFailure("Select a valid family.");

        var members = request.Members
            .Select(value => Clean(value, 150, "Member name"))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (!isVisitor && members.Any(member => !familyEntry!.Members.Contains(member, StringComparer.Ordinal)))
            throw ValidationFailure("One or more selected family members are invalid.");
        if (isVisitor && members.Length == 0)
            throw ValidationFailure("Enter at least one visitor name.");
        if (isVisitor && members.Length > MaxVisitors)
            throw ValidationFailure("Too many visitor names were entered.");

        await _writeGate.WaitAsync(cancellationToken);
        try
        {
            var metadata = await GetMetadataAsync(cancellationToken);
            var now = DateTimeOffset.UtcNow;
            var localDate = TimeZoneInfo.ConvertTime(now, metadata.TimeZone).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var submissionId = ValidSubmissionId(request.SubmissionId) ?? Guid.NewGuid().ToString();
            var checkInId = isVisitor ? $"{localDate}|{VisitorFamily}|{submissionId}" : $"{localDate}|{family}";

            var rows = await GetValuesAsync("CheckIns", cancellationToken);
            if (rows.Count == 0) throw SheetFailure("The CheckIns sheet has no headers.");
            var headers = HeaderMap(rows[0], "CheckIns", CheckInHeaders);
            var matchingRows = rows
                .Select((row, index) => new { Row = row, Index = index })
                .Where(item => item.Index > 0 && CellText(item.Row, headers["CheckInID"]) == checkInId)
                .ToArray();

            var template = matchingRows.FirstOrDefault()?.Row;
            var requests = new JsonArray();
            foreach (var match in matchingRows.OrderByDescending(item => item.Index))
            {
                requests.Add(new JsonObject
                {
                    ["deleteDimension"] = new JsonObject
                    {
                        ["range"] = new JsonObject
                        {
                            ["sheetId"] = metadata.CheckInsSheetId,
                            ["dimension"] = "ROWS",
                            ["startIndex"] = match.Index,
                            ["endIndex"] = match.Index + 1
                        }
                    }
                });
            }

            var memberRows = members.Length > 0 ? members : [""];
            var appendRows = new JsonArray();
            foreach (var member in memberRows)
            {
                var values = new JsonArray();
                var width = rows[0].Count;
                for (var column = 0; column < width; column++)
                {
                    JsonNode? value = template is not null && column < template.Count
                        ? UserValue(template[column])
                        : new JsonObject { ["stringValue"] = "" };
                    if (column == headers["CheckInID"]) value = new JsonObject { ["stringValue"] = checkInId };
                    if (column == headers["Timestamp"]) value = new JsonObject { ["stringValue"] = now.ToString("O") };
                    if (column == headers["Family Name"]) value = new JsonObject { ["stringValue"] = family };
                    if (column == headers["Member Present"]) value = new JsonObject { ["stringValue"] = member };
                    if (column == headers["Notes"]) value = new JsonObject { ["stringValue"] = notes };
                    values.Add(new JsonObject { ["userEnteredValue"] = value });
                }
                appendRows.Add(new JsonObject { ["values"] = values });
            }

            requests.Add(new JsonObject
            {
                ["appendCells"] = new JsonObject
                {
                    ["sheetId"] = metadata.CheckInsSheetId,
                    ["rows"] = appendRows,
                    ["fields"] = "userEnteredValue"
                }
            });
            await BatchUpdateAsync(new JsonObject { ["requests"] = requests }, cancellationToken);

            return new SaveResult(
                matchingRows.Length > 0,
                new CheckInRecord(checkInId, now.ToString("O"), family, members, notes));
        }
        finally
        {
            _writeGate.Release();
        }
    }

    public async Task<CheckInRecord?> GetStatusAsync(CheckInRequest request, CancellationToken cancellationToken)
    {
        var family = Clean(request.Family, 150, "Family name");
        var notes = Clean(request.Notes ?? "", MaxNotesLength, "Notes", allowEmpty: true);
        if (request.Members is null) throw ValidationFailure("Members are invalid.");
        var members = request.Members.Select(value => Clean(value, 150, "Member name"))
            .Distinct(StringComparer.Ordinal).ToArray();
        var families = await GetFamiliesAsync(cancellationToken);
        var familyEntry = families.FirstOrDefault(item => item.Name == family);
        var isVisitor = family == VisitorFamily;
        if (!isVisitor && familyEntry is null) throw ValidationFailure("Select a valid family.");
        if (!isVisitor && members.Any(member => !familyEntry!.Members.Contains(member, StringComparer.Ordinal)))
            throw ValidationFailure("One or more selected family members are invalid.");
        if (isVisitor && (members.Length == 0 || members.Length > MaxVisitors))
            throw ValidationFailure("Visitor names are invalid.");
        var submissionId = ValidSubmissionId(request.SubmissionId)
            ?? throw ValidationFailure("Submission ID is required.");

        var metadata = await GetMetadataAsync(cancellationToken);
        var localDate = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, metadata.TimeZone)
            .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var checkInId = isVisitor ? $"{localDate}|{VisitorFamily}|{submissionId}" : $"{localDate}|{family}";
        var rows = await GetValuesAsync("CheckIns", cancellationToken);
        if (rows.Count == 0) throw SheetFailure("The CheckIns sheet has no headers.");
        var headers = HeaderMap(rows[0], "CheckIns", CheckInHeaders);
        var matches = rows.Skip(1)
            .Where(row => CellText(row, headers["CheckInID"]) == checkInId)
            .ToArray();
        if (matches.Length == 0) return null;
        var savedMembers = matches.Select(row => CellText(row, headers["Member Present"]).Trim())
            .Where(value => value.Length > 0).Distinct(StringComparer.Ordinal).Order().ToArray();
        if (!savedMembers.SequenceEqual(members.Order(), StringComparer.Ordinal) ||
            CellText(matches[0], headers["Family Name"]).Trim() != family ||
            CellText(matches[0], headers["Notes"]).Trim() != notes)
            return null;
        return new CheckInRecord(
            checkInId,
            CellText(matches[0], headers["Timestamp"]),
            family,
            members,
            notes);
    }

    public async Task<AttendanceReportsDto> GetReportsAsync(CancellationToken cancellationToken)
    {
        var families = await GetFamiliesAsync(cancellationToken);
        var metadata = await GetMetadataAsync(cancellationToken);
        var rows = await GetValuesAsync("CheckIns", cancellationToken);
        if (rows.Count == 0) throw SheetFailure("The CheckIns sheet has no headers.");
        var headers = HeaderMap(rows[0], "CheckIns", CheckInHeaders);
        var now = DateTimeOffset.UtcNow;
        var today = TimeZoneInfo.ConvertTime(now, metadata.TimeZone).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var year = int.Parse(today[..4], CultureInfo.InvariantCulture);
        var listRows = await GetValuesAsync("Lists", cancellationToken);
        var parentReport = BuildParentReport(listRows, rows, metadata.TimeZone);
        var familyNames = families.Select(family => family.Name).ToHashSet(StringComparer.Ordinal);
        var reportDates = new SortedSet<string>(StringComparer.Ordinal);
        var thursdayDates = new HashSet<string>(StringComparer.Ordinal);
        var membersToday = families.ToDictionary(f => f.Name, _ => new HashSet<string>(StringComparer.Ordinal));
        var yearlyDates = families.ToDictionary(f => f.Name, _ => new HashSet<string>(StringComparer.Ordinal));

        foreach (var row in rows.Skip(1))
        {
            var family = CellText(row, headers["Family Name"]).Trim();
            if (!familyNames.Contains(family)) continue;
            var id = CellText(row, headers["CheckInID"]);
            var separator = id.IndexOf('|');
            var date = separator > 0 ? id[..separator] : "";
            if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
                continue;

            reportDates.Add(date);
            if (parsed.DayOfWeek == DayOfWeek.Thursday) thursdayDates.Add(date);
            var member = CellText(row, headers["Member Present"]).Trim();
            if (member.Length == 0) continue;
            if (date == today) membersToday[family].Add(member);
            if (parsed.DayOfWeek == DayOfWeek.Thursday) yearlyDates[family].Add(date);
        }

        var dailyFamilies = families.Select(family => new DailyFamilyDto(
            family.Name,
            membersToday[family.Name].Count > 0,
            membersToday[family.Name].Count,
            family.Members.Count)).ToArray();
        var checkedInFamilies = dailyFamilies.Count(family => family.CheckedIn);
        var checkedInMembers = dailyFamilies.Sum(family => family.CheckedInMembers);
        var totalMembers = dailyFamilies.Sum(family => family.TotalMembers);
        var yearlyFamilies = families.Select(family =>
        {
            var attended = yearlyDates[family.Name].Count;
            return new YearlyFamilyDto(family.Name, attended, thursdayDates.Count, Percentage(attended, thursdayDates.Count));
        }).ToArray();

        return new AttendanceReportsDto(
            now.ToString("O"),
            today,
            year,
            new DailyReportDto(
                checkedInFamilies,
                families.Count,
                Percentage(checkedInFamilies, families.Count),
                checkedInMembers,
                totalMembers,
                dailyFamilies),
            new YearlyReportDto(
                reportDates.FirstOrDefault() ?? "",
                reportDates.LastOrDefault() ?? "",
                thursdayDates.Count,
                yearlyFamilies),
            parentReport);
    }

    public static ParentReportDto BuildParentReport(
        IReadOnlyList<IReadOnlyList<JsonElement>> listRows,
        IReadOnlyList<IReadOnlyList<JsonElement>> checkInRows,
        TimeZoneInfo? timeZone = null)
    {
        var total = 0;
        var listHeaders = HeaderMap(listRows[0], "Lists", ["Family Name", "Member Name"]);
        var typeHeader = listHeaders.Keys.FirstOrDefault(key => key.Equals("type", StringComparison.OrdinalIgnoreCase));
        if (typeHeader is null)
            return new(total, [], "Add a type column to Lists and mark each parent as Parent.");
        var parents = new Dictionary<(string Family, string Name), HashSet<DateOnly>>();
        foreach (var row in listRows.Skip(1))
        {
            if (!CellText(row, listHeaders[typeHeader]).Trim().Equals("parent", StringComparison.OrdinalIgnoreCase)) continue;
            var family = CellText(row, listHeaders["Family Name"]).Trim();
            var name = CellText(row, listHeaders["Member Name"]).Trim();
            if (family.Length > 0 && name.Length > 0) parents.TryAdd((family, name), []);
        }
        var headers = HeaderMap(checkInRows[0], "CheckIns", CheckInHeaders);
        var recordedThursdays = new HashSet<DateOnly>();
        foreach (var row in checkInRows.Skip(1))
        {
            var key = (CellText(row, headers["Family Name"]).Trim(), CellText(row, headers["Member Present"]).Trim());
            var dateText = CellText(row, headers["CheckInID"]).Split('|')[0];
            if (!DateOnly.TryParseExact(dateText, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            {
                if (!DateTimeOffset.TryParse(CellText(row, headers["Timestamp"]), CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal, out var timestamp)) continue;
                date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(timestamp, timeZone ?? TimeZoneInfo.Utc).DateTime);
            }
            if (date.DayOfWeek == DayOfWeek.Thursday)
            {
                recordedThursdays.Add(date);
                if (parents.TryGetValue(key, out var dates)) dates.Add(date);
            }
        }
        total = recordedThursdays.Count;
        var result = parents.OrderBy(pair => pair.Key.Family, StringComparer.CurrentCulture)
            .ThenBy(pair => pair.Key.Name, StringComparer.CurrentCulture)
            .Select(pair => new ParentAttendanceDto(pair.Key.Name, pair.Key.Family, pair.Value.Count, total, Percentage(pair.Value.Count, total)))
            .ToArray();
        return new(total, result);
    }

    private async Task<IReadOnlyList<IReadOnlyList<JsonElement>>> GetValuesAsync(string sheet, CancellationToken cancellationToken)
    {
        var spreadsheetId = SpreadsheetId();
        var range = Uri.EscapeDataString($"'{sheet}'!A:ZZ");
        using var request = await AuthorizedRequestAsync(
            HttpMethod.Get,
            $"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING",
            cancellationToken);
        using var response = await clients.CreateClient().SendAsync(request, cancellationToken);
        await EnsureGoogleSuccess(response, cancellationToken);
        var payload = await response.Content.ReadFromJsonAsync<ValuesResponse>(cancellationToken: cancellationToken);
        return payload?.Values?.Select(row => (IReadOnlyList<JsonElement>)row).ToArray() ?? [];
    }

    private async Task<SheetMetadata> GetMetadataAsync(CancellationToken cancellationToken)
    {
        if (cache.TryGetValue("sheet-metadata-v1", out SheetMetadata? cached) && cached is not null) return cached;
        using var request = await AuthorizedRequestAsync(
            HttpMethod.Get,
            $"https://sheets.googleapis.com/v4/spreadsheets/{SpreadsheetId()}?fields=properties.timeZone,sheets.properties(sheetId,title)",
            cancellationToken);
        using var response = await clients.CreateClient().SendAsync(request, cancellationToken);
        await EnsureGoogleSuccess(response, cancellationToken);
        var payload = await response.Content.ReadFromJsonAsync<SpreadsheetResponse>(cancellationToken: cancellationToken)
            ?? throw SheetFailure("Google returned invalid spreadsheet metadata.");
        var checkIns = payload.Sheets?.FirstOrDefault(sheet => sheet.Properties?.Title == "CheckIns")?.Properties;
        if (checkIns is null) throw SheetFailure("Required sheet \"CheckIns\" was not found.");
        TimeZoneInfo timeZone;
        try { timeZone = TimeZoneInfo.FindSystemTimeZoneById(payload.Properties?.TimeZone ?? "America/Los_Angeles"); }
        catch (TimeZoneNotFoundException) { throw SheetFailure("The spreadsheet timezone is invalid."); }
        var result = new SheetMetadata(checkIns.SheetId, timeZone);
        cache.Set("sheet-metadata-v1", result, TimeSpan.FromMinutes(30));
        return result;
    }

    private async Task BatchUpdateAsync(JsonObject body, CancellationToken cancellationToken)
    {
        using var request = await AuthorizedRequestAsync(
            HttpMethod.Post,
            $"https://sheets.googleapis.com/v4/spreadsheets/{SpreadsheetId()}:batchUpdate",
            cancellationToken);
        request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var response = await clients.CreateClient().SendAsync(request, cancellationToken);
        await EnsureGoogleSuccess(response, cancellationToken);
    }

    private async Task<HttpRequestMessage> AuthorizedRequestAsync(HttpMethod method, string url, CancellationToken cancellationToken)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await tokens.GetAsync(cancellationToken));
        return request;
    }

    private static async Task EnsureGoogleSuccess(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode) return;
        var detail = await response.Content.ReadAsStringAsync(cancellationToken);
        throw new ApiFailureException(
            $"Google Sheets rejected the request ({(int)response.StatusCode}). {ShortDetail(detail)}",
            "SHEETS_ERROR",
            StatusCodes.Status502BadGateway);
    }

    private string SpreadsheetId() => configuration["Google:SpreadsheetId"] is { Length: > 0 } id
        ? id
        : throw new ApiFailureException(
            "The Google spreadsheet is not configured.",
            "GOOGLE_NOT_CONFIGURED",
            StatusCodes.Status503ServiceUnavailable);

    private static Dictionary<string, int> HeaderMap(
        IReadOnlyList<JsonElement> row,
        string sheet,
        IReadOnlyList<string> required)
    {
        var map = row.Select((cell, index) => new { Header = ElementText(cell).Trim(), Index = index })
            .Where(item => item.Header.Length > 0)
            .ToDictionary(item => item.Header, item => item.Index, StringComparer.Ordinal);
        foreach (var header in required)
            if (!map.ContainsKey(header)) throw SheetFailure($"Sheet \"{sheet}\" is missing the \"{header}\" column.");
        return map;
    }

    private static string CellText(IReadOnlyList<JsonElement> row, int index) =>
        index < row.Count ? ElementText(row[index]) : "";

    private static string ElementText(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => element.GetString() ?? "",
        JsonValueKind.Number => element.GetRawText(),
        JsonValueKind.True => "TRUE",
        JsonValueKind.False => "FALSE",
        _ => ""
    };

    private static JsonNode UserValue(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Number => new JsonObject { ["numberValue"] = element.GetDouble() },
        JsonValueKind.True => new JsonObject { ["boolValue"] = true },
        JsonValueKind.False => new JsonObject { ["boolValue"] = false },
        _ => new JsonObject { ["stringValue"] = ElementText(element) }
    };

    private static string Clean(string? value, int maxLength, string label, bool allowEmpty = false)
    {
        if (value is null) throw ValidationFailure($"{label} is invalid.");
        var text = value.Trim();
        if (!allowEmpty && text.Length == 0) throw ValidationFailure($"{label} is required.");
        if (text.Length > maxLength) throw ValidationFailure($"{label} is too long.");
        return text;
    }

    private static int Percentage(int value, int total) => total > 0
        ? (int)Math.Round(value * 100d / total, MidpointRounding.AwayFromZero)
        : 0;

    private static string? ValidSubmissionId(string? value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        if (value.Length > 100 || value.Any(character =>
                !char.IsAsciiLetterOrDigit(character) && character != '_' && character != '-'))
            throw ValidationFailure("Submission ID is invalid.");
        return value;
    }

    private static ApiFailureException ValidationFailure(string message) =>
        new(message, "VALIDATION_ERROR", StatusCodes.Status400BadRequest);

    private static ApiFailureException SheetFailure(string message) =>
        new(message, "SHEETS_ERROR", StatusCodes.Status502BadGateway);

    private static string ShortDetail(string value) => value.Length <= 180 ? value : value[..180];

    private sealed record ValuesResponse(JsonElement[][]? Values);
    private sealed record SpreadsheetResponse(SpreadsheetProperties? Properties, Sheet[]? Sheets);
    private sealed record SpreadsheetProperties(string? TimeZone);
    private sealed record Sheet(SheetProperties? Properties);
    private sealed record SheetProperties(int SheetId, string? Title);
    private sealed record SheetMetadata(int CheckInsSheetId, TimeZoneInfo TimeZone);
}
