using GroupMonkey.Api.Data;
using GroupMonkey.Api.Models;

namespace GroupMonkey.Api.Services;

public static class Progress
{
    public static int Percent(int done, int total) =>
        total == 0 ? 0 : (int)Math.Round(done * 100.0 / total, MidpointRounding.AwayFromZero);

    public static ProjectDto ToDto(DataStore s, Project p, User viewer)
    {
        var tasks = s.Tasks.Where(t => t.ProjectId == p.Id).ToList();
        var done = tasks.Count(t => t.Status == WorkStatus.Done);
        return new ProjectDto(p.Id, p.Name, p.Description, p.Status, p.StartDate, p.DueDate, p.OwnerId,
            s.Visible(p.MemberIds), tasks.Count, done, Percent(done, tasks.Count),
            Access.CanManage(viewer, p), Access.CanEdit(viewer, p));
    }

    public static GroupDto ToDto(DataStore s, Group g)
    {
        var tasks = s.Tasks.Where(t => t.GroupId == g.Id).ToList();
        var done = tasks.Count(t => t.Status == WorkStatus.Done);
        return new GroupDto(g.Id, g.ProjectId, g.Name, g.Color, s.Visible(g.MemberIds), tasks.Count, done, Percent(done, tasks.Count));
    }

    public static GoalDto ToDto(DataStore s, Goal g)
    {
        var tasks = s.Tasks.Where(t => t.GoalId == g.Id).ToList();
        var done = tasks.Count(t => t.Status == WorkStatus.Done);
        return new GoalDto(g.Id, g.ProjectId, g.Title, g.Description, g.TargetDate, tasks.Count, done, Percent(done, tasks.Count));
    }

    public static ProjectSummary Summarise(DataStore s, Project p)
    {
        var tasks = s.Tasks.Where(t => t.ProjectId == p.Id).ToList();
        var today = DateOnly.FromDateTime(DateTime.Today);
        var done = tasks.Count(t => t.Status == WorkStatus.Done);

        var byStatus = Enum.GetValues<WorkStatus>().ToDictionary(st => st, st => tasks.Count(t => t.Status == st));
        var groups = s.Groups.Where(g => g.ProjectId == p.Id).Select(g =>
        {
            var gt = tasks.Where(t => t.GroupId == g.Id).ToList();
            var gd = gt.Count(t => t.Status == WorkStatus.Done);
            return new GroupProgress(g.Id, g.Name, g.Color, gt.Count, gd, Percent(gd, gt.Count));
        }).ToList();
        var members = s.Visible(p.MemberIds).Select(uid =>
        {
            var mt = tasks.Where(t => t.AssigneeId == uid).ToList();
            var md = mt.Count(t => t.Status == WorkStatus.Done);
            var kind = s.IsAgent(uid) ? UserKind.Agent : UserKind.Human;
            return new MemberProgress(uid, mt.Count, md, Percent(md, mt.Count), kind);
        }).ToList();

        var overdue = tasks.Count(t => t.Status != WorkStatus.Done && t.DueDate is { } d && d < today);
        return new ProjectSummary(p.Id, tasks.Count, done, Percent(done, tasks.Count), overdue, byStatus, groups, members);
    }
}
