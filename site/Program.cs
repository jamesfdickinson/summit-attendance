using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using SummitCheckIn.Web;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<AccessService>();
builder.Services.AddSingleton<GoogleTokenProvider>();
builder.Services.AddSingleton<GoogleSheetsAttendanceStore>();

var app = builder.Build();

app.Use(async (context, next) =>
{
    var stopwatch = Stopwatch.StartNew();
    try
    {
        await next(context);
    }
    catch (ApiFailureException error) when (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.StatusCode = error.StatusCode;
        await context.Response.WriteAsJsonAsync(new { ok = false, error = error.Message, code = error.Code });
    }
    catch (Exception error) when (context.Request.Path.StartsWithSegments("/api"))
    {
        app.Logger.LogError(error, "Unhandled API failure for {Method} {Path}", context.Request.Method, context.Request.Path);
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(new
        {
            ok = false,
            error = "The request could not be completed.",
            code = "SERVER_ERROR"
        });
    }
    finally
    {
        if (context.Request.Path.StartsWithSegments("/api"))
        {
            stopwatch.Stop();
            app.Logger.LogInformation(
                "{Method} {Path} returned {StatusCode} in {ElapsedMilliseconds} ms",
                context.Request.Method,
                context.Request.Path,
                context.Response.StatusCode,
                stopwatch.ElapsedMilliseconds);
        }
    }
});

app.UseHttpsRedirection();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        var extension = Path.GetExtension(context.File.Name);
        if (extension is ".html" or ".js" or ".css" or ".webmanifest")
            context.Context.Response.Headers.CacheControl = "no-cache";
    }
});

var api = app.MapGroup("/api");
api.AddEndpointFilter(async (invocation, next) =>
{
    invocation.HttpContext.Response.Headers.CacheControl = "no-store";
    return await next(invocation);
});

api.MapGet("/health", () => Results.Ok(new { ok = true }));

api.MapPost("/access", (HttpRequest request, AccessService access) =>
{
    var accessLevel = access.Require(request, adminOnly: false);
    return Results.Ok(new { ok = true, accessLevel });
});

api.MapGet("/families", async (
    HttpRequest request,
    AccessService access,
    GoogleSheetsAttendanceStore store,
    CancellationToken cancellationToken) =>
{
    var accessLevel = access.Require(request, adminOnly: false);
    var families = await store.GetFamiliesAsync(cancellationToken);
    return Results.Ok(new { ok = true, accessLevel, families });
});

api.MapPost("/check-ins", async (
    HttpRequest request,
    CheckInRequest body,
    AccessService access,
    GoogleSheetsAttendanceStore store,
    CancellationToken cancellationToken) =>
{
    var accessLevel = access.Require(request, adminOnly: false);
    var result = await store.SaveAsync(body, cancellationToken);
    return Results.Ok(new
    {
        ok = true,
        accessLevel,
        updated = result.Updated,
        record = result.Record
    });
});

api.MapPost("/check-ins/status", async (
    HttpRequest request,
    CheckInRequest body,
    AccessService access,
    GoogleSheetsAttendanceStore store,
    CancellationToken cancellationToken) =>
{
    var accessLevel = access.Require(request, adminOnly: false);
    var record = await store.GetStatusAsync(body, cancellationToken);
    return Results.Ok(new { ok = true, accessLevel, saved = record is not null, record });
});

api.MapGet("/reports", async (
    HttpRequest request,
    AccessService access,
    GoogleSheetsAttendanceStore store,
    CancellationToken cancellationToken) =>
{
    access.Require(request, adminOnly: true);
    var reports = await store.GetReportsAsync(cancellationToken);
    return Results.Ok(new { ok = true, accessLevel = "admin", reports });
});

app.MapFallbackToFile("index.html");
app.Run();

public partial class Program;

namespace SummitCheckIn.Web
{
    public sealed class AccessService(IConfiguration configuration)
    {
        public string Require(HttpRequest request, bool adminOnly)
        {
            var basic = configuration["Summit:AccessPassword"];
            var admin = configuration["Summit:AdminPassword"];
            if (string.IsNullOrEmpty(basic) || string.IsNullOrEmpty(admin))
                throw new ApiFailureException("Access passwords are not configured.", "AUTH_NOT_CONFIGURED", 503);

            var submitted = request.Headers["X-Summit-Password"].ToString();
            if (Matches(submitted, admin)) return "admin";
            if (!adminOnly && Matches(submitted, basic)) return "basic";
            throw new ApiFailureException("The password is incorrect. Please try again.", "AUTH_REQUIRED", 401);
        }

        private static bool Matches(string submitted, string expected)
        {
            var left = Encoding.UTF8.GetBytes(submitted);
            var right = Encoding.UTF8.GetBytes(expected);
            return left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);
        }
    }

    public sealed record CheckInRequest(string? Family, IReadOnlyList<string>? Members, string? Notes, string? SubmissionId);
    public sealed record FamilyDto(string Name, IReadOnlyList<string> Members);
    public sealed record CheckInRecord(string CheckInId, string Timestamp, string Family, IReadOnlyList<string> Members, string Notes);
    public sealed record SaveResult(bool Updated, CheckInRecord Record);
    public sealed record DailyFamilyDto(string Name, bool CheckedIn, int CheckedInMembers, int TotalMembers);
    public sealed record YearlyFamilyDto(string Name, int AttendedThursdays, int TotalThursdays, int Percent);
    public sealed record DailyReportDto(int CheckedInFamilies, int TotalFamilies, int FamilyPercent, int CheckedInMembers, int TotalMembers, IReadOnlyList<DailyFamilyDto> Families);
    public sealed record YearlyReportDto(string StartDate, string EndDate, int ThursdaysWithData, IReadOnlyList<YearlyFamilyDto> Families);
    public sealed record AttendanceReportsDto(string GeneratedAt, string Date, int Year, DailyReportDto Daily, YearlyReportDto Yearly);

    public sealed class ApiFailureException(string message, string code, int statusCode) : Exception(message)
    {
        public string Code { get; } = code;
        public int StatusCode { get; } = statusCode;
    }
}
