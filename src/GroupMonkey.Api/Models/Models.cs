namespace GroupMonkey.Api.Models;

public enum Role { Admin, Manager, Member }
public enum ProjectStatus { Planning, Active, OnHold, Completed }
public enum WorkStatus { Todo, InProgress, Review, Done }
public enum Priority { Low, Medium, High, Urgent }
public enum UserKind { Human, Agent }
public enum Autonomy { Suggest, AskFirst, Autonomous }
public enum RunStatus { Queued, Running, AwaitingApproval, NeedsInput, Succeeded, Failed, Cancelled }
public enum StepType { Thought, ToolCall, ToolResult, Message }
public enum ActionState { Pending, Approved, Rejected }

// MOCK ONLY: passwords are stored in plain text for seeded demo users.
public class User
{
    public UserKind Kind { get; set; } = UserKind.Human;
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
    public Role Role { get; set; }
    public string Color { get; set; } = "#FFD400";
}

public class Project
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public ProjectStatus Status { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly DueDate { get; set; }
    public int OwnerId { get; set; }
    public List<int> MemberIds { get; set; } = [];
}

public class Group
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#FFD400";
    public List<int> MemberIds { get; set; } = [];
}

public class TaskItem
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int? GroupId { get; set; }
    public int? GoalId { get; set; }
    public int? AssigneeId { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public WorkStatus Status { get; set; }
    public Priority Priority { get; set; }
    public DateOnly? DueDate { get; set; }
}

public class Goal
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public DateOnly? TargetDate { get; set; }
}
