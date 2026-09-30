# Final Architecture State

USER -> ChatView -> LocalForgeEngine.executeTask -> ExecutionCoordinator -> MultiAgentOrchestrator -> TaskGraph -> AgentManager -> AgentLoop -> ModelRouter/Provider -> ToolRegistry -> policy/permission -> tools -> EditEngine/TerminalManager -> validation -> result.

Slash/maintenance commands remain isolated in the legacy handler.
