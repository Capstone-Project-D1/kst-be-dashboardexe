import { requestUpstream, type GatewayRequestOptions } from "../gateway/gateway.client.js";

type JatikertoRequestOptions = Omit<GatewayRequestOptions, "kstIdentifier">;

export function requestJatikerto(options: JatikertoRequestOptions) {
  return requestUpstream({
    ...options,
    kstIdentifier: "jatikerto",
  });
}
