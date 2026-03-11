import type { Agent, ChannelBinding } from '../api';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

const CHANNEL_LABELS: Record<string, string> = {
  webchat: 'WebChat',
  slack: 'Slack',
  discord: 'Discord',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  teams: 'Teams',
  email: 'Email',
};

interface Props {
  bindings: ChannelBinding[];
  agents: Agent[];
}

export function ChannelStatus({ bindings, agents }: Props) {
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Group bindings by channel name
  const byChannel = new Map<string, ChannelBinding[]>();
  for (const b of bindings) {
    const existing = byChannel.get(b.channelName) ?? [];
    existing.push(b);
    byChannel.set(b.channelName, existing);
  }

  const allChannels = ['webchat', 'slack', 'discord', 'telegram', 'whatsapp', 'teams', 'email'];

  if (bindings.length === 0) {
    return (
      <div className="empty-state">
        No channel bindings configured. Create bindings via the API to connect agents to channels.
      </div>
    );
  }

  return (
    <div className="hand-grid">
      {allChannels.map((channelName) => {
        const channelBindings = byChannel.get(channelName);
        if (!channelBindings || channelBindings.length === 0) return null;

        const activeCount = channelBindings.filter((b) => b.isActive).length;

        return (
          <div key={channelName} className="hand-card">
            <div className="hand-card-header">
              <h3 className="hand-card-name">{CHANNEL_LABELS[channelName] ?? channelName}</h3>
              <span className={`status-badge status-${activeCount > 0 ? 'active' : 'inactive'}`}>
                <span className="status-dot" />
                {activeCount > 0 ? `${activeCount} active` : 'inactive'}
              </span>
            </div>

            <div className="hand-card-body">
              <div className="hand-card-row">
                <span className="hand-card-label">Bindings</span>
                <span className="hand-card-value">{channelBindings.length}</span>
              </div>

              {channelBindings.map((binding) => {
                const agent = agentMap.get(binding.agentId);
                return (
                  <div key={binding.id} className="hand-card-row">
                    <span className="hand-card-label">{binding.bindingType}</span>
                    <span className="hand-card-value">
                      {agent?.name ?? binding.agentId.slice(0, 8)}
                      {binding.externalChannelId ? ` (${binding.externalChannelId})` : ''}
                      {!binding.isActive ? ' [off]' : ''}
                    </span>
                  </div>
                );
              })}

              <div className="hand-card-row">
                <span className="hand-card-label">Created</span>
                <span className="hand-card-value">{formatDate(channelBindings[0]!.createdAt)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
