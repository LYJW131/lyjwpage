import { issueApiDeveloperToken } from "./musickit-token";
import { currentContext } from "./runtime";

export async function appleDeveloperToken(): Promise<string> {
  return (await issueApiDeveloperToken(currentContext().env)).token;
}
