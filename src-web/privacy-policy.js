import privacyPolicySource from "./privacy-policy.md?raw";
import { renderPrivacyPolicy } from "./privacy-policy-format.js";

export const privacyPolicyHtml = renderPrivacyPolicy(privacyPolicySource);
