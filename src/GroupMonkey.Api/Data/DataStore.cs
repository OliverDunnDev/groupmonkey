using GroupMonkey.Api.Models;

namespace GroupMonkey.Api.Data;

/// <summary>In-memory store seeded with mock data. Resets whenever the API restarts.</summary>
public class DataStore
{
    public readonly object Sync = new();
    public List<User> Users { get; } = [];
    public List<Project> Projects { get; } = [];
    public List<Group> Groups { get; } = [];
    public List<TaskItem> Tasks { get; } = [];
    public List<Goal> Goals { get; } = [];

    // ---- AI feature (optional; see AiSettingsStore) ----
    public List<AgentConfig> Agents { get; } = [];
    public List<TaskComment> Comments { get; } = [];
    public List<AgentRun> Runs { get; } = [];
    public List<ProposedAction> Actions { get; } = [];

    /// <summary>Mirrors the admin's AI switch. When false, agents are hidden from every response.</summary>
    public volatile bool AiEnabled;

    private int _project, _group, _task, _goal, _comment, _run, _action;
    public int NextProjectId() => ++_project;
    public int NextGroupId() => ++_group;
    public int NextTaskId() => ++_task;
    public int NextGoalId() => ++_goal;
    public int NextCommentId() => ++_comment;
    public int NextRunId() => ++_run;
    public int NextActionId() => ++_action;

    public bool IsAgent(int userId) => Users.Any(u => u.Id == userId && u.Kind == UserKind.Agent);

    /// <summary>Filters agent ids out of member lists while the AI feature is off.</summary>
    public List<int> Visible(IEnumerable<int> ids) =>
        AiEnabled ? [.. ids] : [.. ids.Where(id => !IsAgent(id))];

    public static DataStore Seeded()
    {
        var s = new DataStore();
        SeedData.Populate(s);
        return s;
    }
}
