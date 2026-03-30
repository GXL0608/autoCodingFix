import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { AutofixQueue } from "./queue"

export namespace AutofixReport {
  export async function write(project_id: string, directory: string, runID: string) {
    const detail = await AutofixQueue.detailByScope(project_id, directory, runID)
    if (!detail) throw new Error("Autofix report run not found")
    const plan = detail.run.plan
    const dir = path.join(Global.Path.data, "autofix", detail.run.project_id, detail.run.id)
    const report_json_path = path.join(dir, "report.json")
    const report_md_path = path.join(dir, "report.md")
    await Filesystem.writeJson(report_json_path, detail)
    const md = [
      `# Autofix Run ${detail.run.id}`,
      "",
      `- Feedback: ${detail.feedback?.external_id ?? "unknown"}`,
      `- Status: ${detail.run.status}`,
      `- Session: ${detail.run.session_id ?? "n/a"}`,
      `- Commit: ${detail.run.commit_hash ?? "n/a"}`,
      `- Version: ${detail.run.version ?? "n/a"}`,
      detail.feedback?.recognized_text ? "" : "",
      detail.feedback?.recognized_text ? "## Feedback" : undefined,
      detail.feedback?.recognized_text ?? undefined,
      plan ? "" : undefined,
      plan ? "## Plan" : undefined,
      plan?.summary ?? undefined,
      plan ? "" : undefined,
      plan ? "### Scope" : undefined,
      plan?.scope.map((item: string) => `- ${item}`).join("\n") ?? undefined,
      plan ? "" : undefined,
      plan ? "### Steps" : undefined,
      plan?.steps.map((item: string) => `- ${item}`).join("\n") ?? undefined,
      plan ? "" : undefined,
      plan ? "### Acceptance" : undefined,
      plan?.acceptance.map((item: string) => `- ${item}`).join("\n") ?? undefined,
      plan ? "" : undefined,
      plan ? "### Architecture" : undefined,
      plan?.architecture
        .map((item) => [`- ${item.name}`, `  Files: ${item.files.join(", ") || "n/a"}`, `  Logic: ${item.logic}`].join("\n"))
        .join("\n") ?? undefined,
      plan ? "" : undefined,
      plan ? "### Methods" : undefined,
      plan?.methods
        .map((item) => [`- ${item.name}`, `  File: ${item.file}`, `  Comment: ${item.comment}`, `  Logic: ${item.logic}`].join("\n"))
        .join("\n") ?? undefined,
      plan ? "" : undefined,
      plan ? "### Flows" : undefined,
      plan?.flows.map((item: string) => `- ${item}`).join("\n") ?? undefined,
      plan?.blockers?.length ? "" : undefined,
      plan?.blockers?.length ? "### Blockers" : undefined,
      plan?.blockers?.map((item: string) => `- ${item}`).join("\n") ?? undefined,
      "",
      "## Attempts",
      ...detail.attempts.map((item: (typeof detail.attempts)[number]) => `- Attempt ${item.attempt}: ${item.status}${item.error ? ` - ${item.error}` : ""}`),
      "",
      "## Artifacts",
      ...detail.artifacts.map((item: (typeof detail.artifacts)[number]) => `- ${item.kind}: ${item.path}`),
      "",
      "## Events",
      ...detail.events.map((item: (typeof detail.events)[number]) => `- [${item.level}] ${item.phase}: ${item.message}`),
    ]
      .filter((item): item is string => item !== undefined)
      .join("\n")
    await Filesystem.write(report_md_path, md)
    return {
      report_json_path,
      report_md_path,
    }
  }
}
