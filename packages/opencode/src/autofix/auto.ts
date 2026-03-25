import { Instance } from "@/project/instance"
import type { SessionID } from "@/session/schema"

const mark = /\(\s*recommended\s*\)|（\s*推荐\s*）|(?:^|[\s:：])recommended(?:$|[\s:：])|建议|推荐/i

function pick(info: {
  options: {
    label: string
    description: string
  }[]
  multiple?: boolean
}) {
  const opts = info.options.filter((item) => mark.test(item.label) || mark.test(item.description))
  if (opts.length) return info.multiple ? opts.map((item) => item.label) : [opts[0].label]
  const first = info.options[0]?.label
  if (!first) return []
  return [first]
}

export namespace AutofixAuto {
  const sessions = Instance.state(
    () => new Set<SessionID>(),
    async (set) => {
      set.clear()
    },
  )

  export function enable(sessionID: SessionID) {
    sessions().add(sessionID)
  }

  export function disable(sessionID: SessionID) {
    sessions().delete(sessionID)
  }

  export function has(sessionID: SessionID) {
    return sessions().has(sessionID)
  }

  export function answers(
    questions: {
      options: {
        label: string
        description: string
      }[]
      multiple?: boolean
    }[],
  ) {
    return questions.map(pick)
  }
}
