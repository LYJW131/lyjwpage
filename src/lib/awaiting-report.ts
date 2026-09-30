export class AwaitingReport extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwaitingReport";
  }
}
