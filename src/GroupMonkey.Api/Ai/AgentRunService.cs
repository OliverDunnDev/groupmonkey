using System.Collections.Concurrent;
using System.Threading.Channels;
using GroupMonkey.Api.Data;
using GroupMonkey.Api.Models;

namespace GroupMonkey.Api.Ai;

/// <summary>Queues and executes agent runs in the background, a few at a time.</summary>
public class AgentRunService(DataStore store, AiSettingsStore settings, IConfiguration config, ILogger<AgentRunService> log) : BackgroundService
{
    private const int MaxConcurrentRuns = 4;

    private readonly Channel<int> _queue = Channel.CreateUnbounded<int>();
    private readonly ConcurrentDictionary<int, CancellationTokenSource> _running = new();
    private readonly SemaphoreSlim _slots = new(MaxConcurrentRuns);

    /// <summary>Creates a queued run for an agent on a task. Returns an error message instead of a run when not allowed.</summary>
    public (AgentRun? Run, string? Error) TryStart(int taskId, int agentId, string triggeredBy)
    {
        lock (store.Sync)
        {
            if (!store.AiEnabled) return (null, "AI agents are not enabled.");
            var agent = store.Users.FirstOrDefault(u => u.Id == agentId && u.Kind == UserKind.Agent);
            var cfg = store.Agents.FirstOrDefault(a => a.UserId == agentId);
            if (agent is null || cfg is null) return (null, "That agent no longer exists.");
            if (!cfg.Enabled) return (null, $"{agent.Name} is switched off.");

            var task = store.Tasks.FirstOrDefault(t => t.Id == taskId);
            if (task is null) return (null, "Task not found.");
            var project = store.Projects.FirstOrDefault(p => p.Id == task.ProjectId);
            if (project is null || !store.IsMember(project, agentId)) return (null, $"{agent.Name} is not a member of this project's group.");

            if (store.Runs.Any(r => r.TaskId == taskId && r.AgentId == agentId && r.Status is RunStatus.Queued or RunStatus.Running))
                return (null, $"{agent.Name} is already working on this task.");

            var today = DateTime.UtcNow.Date;
            if (store.Runs.Count(r => r.AgentId == agentId && r.CreatedAt >= today) >= cfg.DailyRunLimit)
                return (null, $"{agent.Name} has reached its limit of {cfg.DailyRunLimit} runs today.");

            var mode = settings.Mode;
            var run = new AgentRun
            {
                Id = store.NextRunId(), AgentId = agentId, TaskId = taskId, ProjectId = project.Id,
                CreatedAt = DateTime.UtcNow, Provider = mode, Model = mode == "Claude" ? cfg.Model ?? settings.Model : null,
                TriggeredBy = triggeredBy,
            };
            store.Runs.Add(run);
            _queue.Writer.TryWrite(run.Id);
            return (run, null);
        }
    }

    public bool Cancel(int runId)
    {
        lock (store.Sync)
        {
            var run = store.Runs.FirstOrDefault(r => r.Id == runId);
            if (run is null) return false;
            if (run.Status == RunStatus.Queued)
            {
                run.Status = RunStatus.Cancelled;
                run.EndedAt = DateTime.UtcNow;
                run.Steps.Add(new RunStep { Type = StepType.Message, Content = "Cancelled before it started.", At = DateTime.UtcNow });
            }
            else if (run.Status == RunStatus.Running && _running.TryGetValue(runId, out var cts))
            {
                cts.Cancel();
            }
            return true;
        }
    }

    /// <summary>After human decisions on proposed actions, a run waiting on approval becomes Succeeded.</summary>
    public static void Settle(DataStore store, AgentRun run)
    {
        lock (store.Sync)
        {
            if (run.Status != RunStatus.AwaitingApproval) return;
            var stillPending = run.ActionIds.Any(id => store.Actions.Any(a => a.Id == id && a.State == ActionState.Pending));
            if (!stillPending) run.Status = RunStatus.Succeeded;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var id in _queue.Reader.ReadAllAsync(stoppingToken))
            {
                await _slots.WaitAsync(stoppingToken);
                var runId = id;
                _ = Task.Run(async () =>
                {
                    try { await Process(runId, stoppingToken); }
                    finally { _slots.Release(); }
                }, CancellationToken.None);
            }
        }
        catch (OperationCanceledException)
        {
            // Shutting down.
        }
    }

    private async Task Process(int runId, CancellationToken stopping)
    {
        AgentRunContext ctx;
        IAgentModel model;
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(stopping);

        lock (store.Sync)
        {
            var run = store.Runs.FirstOrDefault(r => r.Id == runId);
            if (run is null || run.Status != RunStatus.Queued) return;

            var agent = store.Users.FirstOrDefault(u => u.Id == run.AgentId);
            var cfg = store.Agents.FirstOrDefault(a => a.UserId == run.AgentId);
            var project = store.Projects.FirstOrDefault(p => p.Id == run.ProjectId);
            if (agent is null || cfg is null || project is null || !store.Tasks.Any(t => t.Id == run.TaskId))
            {
                Finish(run, RunStatus.Failed, "The agent, project or task no longer exists.");
                return;
            }

            // Decide the provider now: a key removed since queueing falls back to demo mode.
            var key = settings.ActiveKey;
            model = key is null ? new MockAgentModel(config.GetValue("Ai:MockDelayMs", 900)) : new ClaudeAgentModel(key, config["Anthropic:BaseUrl"]);
            run.Provider = model.Provider;
            var modelName = key is null ? "mock" : run.Model ?? cfg.Model ?? settings.Model;
            run.Model = key is null ? null : modelName;
            run.Status = RunStatus.Running;
            run.StartedAt = DateTime.UtcNow;
            ctx = new AgentRunContext(store, run, agent, cfg, project, run.TaskId, modelName);
            _running[runId] = cts;
        }

        try
        {
            await model.RunAsync(ctx, cts.Token);
            lock (store.Sync)
            {
                var pending = ctx.Run.ActionIds.Any(id => store.Actions.Any(a => a.Id == id && a.State == ActionState.Pending));
                Finish(ctx.Run, ctx.Tools.NeedsInput ? RunStatus.NeedsInput : pending ? RunStatus.AwaitingApproval : RunStatus.Succeeded, null);
            }
        }
        catch (OperationCanceledException)
        {
            lock (store.Sync) Finish(ctx.Run, RunStatus.Cancelled, null);
        }
        catch (AgentRunException ex)
        {
            Fail(ctx, ex.Message);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Agent run {RunId} failed unexpectedly", runId);
            Fail(ctx, $"Unexpected error ({ex.GetType().Name}). See the server log.");
        }
        finally
        {
            _running.TryRemove(runId, out _);
        }
    }

    private void Fail(AgentRunContext ctx, string message)
    {
        lock (store.Sync)
        {
            Finish(ctx.Run, RunStatus.Failed, message);
            // Leave a visible note on the task so the team knows why nothing happened.
            store.Comments.Add(new TaskComment
            {
                Id = store.NextCommentId(), TaskId = ctx.TaskId, AuthorId = ctx.Agent.Id,
                Body = "I couldn't finish this run: " + message, CreatedAt = DateTime.UtcNow,
            });
        }
    }

    private static void Finish(AgentRun run, RunStatus status, string? error)
    {
        run.Status = status;
        run.EndedAt = DateTime.UtcNow;
        run.Error = error;
        if (error is not null) run.Steps.Add(new RunStep { Type = StepType.Message, Content = "Run failed: " + error, At = DateTime.UtcNow });
    }
}
