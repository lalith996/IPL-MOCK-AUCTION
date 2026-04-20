export class AuctionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly ruleId?: string,
  ) {
    super(message);
    this.name = 'AuctionError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class IsolationLeakError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly leakedField: string,
  ) {
    super(`Isolation leak: agent ${agentId} accessed field ${leakedField}`);
    this.name = 'IsolationLeakError';
  }
}
