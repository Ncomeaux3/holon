import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { withLog } from '@/core/log'
import { registerTools, tokenMatches } from '@/core/mcp'

// A tool call is one query or one model call; a minute is generous.
export const maxDuration = 60

// The one MCP server. Claude Code and the Claude app connect here; the
// orchestrator uses the same registry in process. There is no in-app chat.
//
//   claude mcp add --transport http pos <url>/api/mcp \
//     --header "Authorization: Bearer $MCP_TOKEN"

const handler = createMcpHandler(
  (server) => {
    registerTools(server)
  },
  { serverInfo: { name: 'pos', version: '0.1.0' } },
)

/**
 * One bearer token, checked in constant time. This is not OAuth: there is one
 * owner and one token, and the endpoint is either you or it is nobody.
 */
const authed = withMcpAuth(
  handler,
  (_request, bearerToken) => {
    if (!tokenMatches(bearerToken, process.env.MCP_TOKEN)) return undefined
    return { token: bearerToken!, scopes: [], clientId: 'pos-owner', extra: {} }
  },
  { required: true },
)

// Rate limited and logged like every other route under app/api.
const logged = withLog(authed)

export { logged as GET, logged as POST, logged as DELETE }
