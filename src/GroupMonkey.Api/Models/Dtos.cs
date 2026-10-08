namespace GroupMonkey.Api.Models;

public record LoginRequest(string Email, string Password);
public record UserDto(int Id, string Name, string Email, Role Role, string Color, UserKind Kind = UserKind.Human);
public record LoginResponse(string Token, UserDto User);

public record ProjectInput(string Name, string? Description, ProjectStatus? Status, DateOnly? StartDate, DateOnly? DueDate, List<int>? MemberIds);
public record GroupInput(string Name, string? Color);
public record TaskInput(string Title, string? Description, WorkStatus? Status, Priority? Priority, int? AssigneeId, int? GroupId, int? GoalId, DateOnly? DueDate);
public record StatusInput(WorkStatus Status);
public record AssigneeInput(int? AssigneeId);
public record GoalInput(string Title, string? Description, DateOnly? TargetDate);

public record ProjectDto(
    int Id, string Name, string Description, ProjectStatus Status, DateOnly StartDate, DateOnly DueDate,
    int OwnerId, List<int> MemberIds, int TaskCount, int DoneCount, int Percent, bool CanManage, bool CanEdit);

public record GroupDto(int Id, int ProjectId, string Name, string Color, List<int> MemberIds, int TaskCount, int DoneCount, int Percent);

public record GoalDto(int Id, int ProjectId, string Title, string Description, DateOnly? TargetDate, int TaskCount, int DoneCount, int Percent);

public record GroupProgress(int GroupId, string Name, string Color, int Total, int Done, int Percent);
public record MemberProgress(int UserId, int Total, int Done, int Percent, UserKind Kind = UserKind.Human);

// ---- AI feature ----
public record AiStatusDto(bool Enabled, string Mode);
public record AiSettingsDto(bool Enabled, string Mode, string DefaultModel, bool HasKey, string? KeyHint, string KeySource, string[] Models);
public record AiSettingsInput(bool? Enabled, string? DefaultModel, string? ApiKey, bool? ClearKey);
public record AiTestResult(bool Ok, string Message);

public record AgentInput(string Name, string? Description, string? Instructions, string? Model, Autonomy? Autonomy,
    List<string>? AllowedTools, bool? Enabled, int? DailyRunLimit, List<int>? ProjectIds, string? Color);
public record AgentDto(int UserId, string Name, string Color, string Description, string Instructions, string? Model,
    Autonomy Autonomy, List<string> AllowedTools, bool Enabled, int DailyRunLimit, List<int> ProjectIds,
    int RunsToday, RunStatus? LastRunStatus, DateTime? LastRunAt, int ActiveRuns, bool CanEdit);
public record AgentTemplateDto(string Key, string Name, string Description, string Instructions, Autonomy Autonomy, List<string> AllowedTools, string Color);

public record CommentInput(string Body);
public record CommentDto(int Id, int TaskId, int AuthorId, string Body, DateTime CreatedAt);

public record RunStepDto(StepType Type, string Content, DateTime At);
public record ActionDto(int Id, int RunId, int AgentId, int ProjectId, int TaskId, string TaskTitle, string Tool, string Summary, ActionState State, int? DecidedBy, DateTime CreatedAt);
public record RunDto(int Id, int AgentId, int TaskId, int ProjectId, RunStatus Status, DateTime CreatedAt, DateTime? StartedAt, DateTime? EndedAt,
    string Provider, string? Model, long InputTokens, long OutputTokens, string? Error, string? TriggeredBy,
    List<RunStepDto> Steps, List<ActionDto> Actions);
public record RunSummaryDto(int Id, int AgentId, int TaskId, int ProjectId, string TaskTitle, RunStatus Status, DateTime CreatedAt, DateTime? EndedAt, string Provider);

public record ProjectSummary(
    int ProjectId, int Total, int Done, int Percent, int Overdue,
    Dictionary<WorkStatus, int> ByStatus, List<GroupProgress> Groups, List<MemberProgress> Members);
