using System.Text;
using System.Text.Json.Serialization;
using GroupMonkey.Api.Ai;
using GroupMonkey.Api.Data;
using GroupMonkey.Api.Endpoints;
using GroupMonkey.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Default to the port the Vite dev proxy expects, even without the launch profile.
if (string.IsNullOrEmpty(builder.Configuration["urls"]) && string.IsNullOrEmpty(builder.Configuration["ASPNETCORE_URLS"]))
    builder.WebHost.UseUrls("http://localhost:5080");

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
builder.Services.AddSingleton(jwt);
builder.Services.AddSingleton<TokenService>();
builder.Services.AddSingleton(_ => DataStore.Seeded());

// Optional AI feature: encrypted key storage, settings, and the background agent runner.
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("GroupMonkey");
// Resolved lazily so the data directory can be overridden by configuration (and by tests).
builder.Services.AddOptions<KeyManagementOptions>().Configure<IConfiguration, IWebHostEnvironment, ILoggerFactory>((o, cfg, env, logs) =>
{
    var dir = cfg["Ai:DataDir"] ?? Path.Combine(env.ContentRootPath, "App_Data");
    o.XmlRepository = new FileSystemXmlRepository(new DirectoryInfo(Path.Combine(dir, "keys")), logs);
});
if (OperatingSystem.IsWindows()) dataProtection.ProtectKeysWithDpapi();
builder.Services.AddSingleton<AiSettingsStore>();
builder.Services.AddSingleton<AgentRunService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<AgentRunService>());

builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Issuer,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            NameClaimType = "name",
            RoleClaimType = "role",
        };
    });
builder.Services.AddAuthorization();

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins("http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "tauri://localhost", "http://tauri.localhost")
    .AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapApi();
app.MapAi();

app.Run();

public partial class Program;
