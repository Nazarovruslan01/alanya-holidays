import type { TFunction } from 'i18next';

// Preserve schema rules/messages while translating their public presentation.
const validationKeys: Record<string, string> = {
  "Please fill in all fields.": "auth.fillAllFields",
  "Please enter your email address.": "auth.emailRequired",
  "Invalid email address": "auth.invalidEmail",
  "Password must be at least 8 characters.": "auth.passwordMin",
  "Passwords don't match.": "auth.passwordMismatch",
  "Business name must be at least 2 characters.": "auth.businessNameMin",
  "Business name must be at most 120 characters.": "auth.businessNameMax",
  "Please select a valid account type.": "auth.accountTypeInvalid",
  "Contact phone must be at least 7 characters.": "auth.phoneMin",
  "Contact phone must be at most 32 characters.": "auth.phoneMax",
  "Website must be at most 2048 characters.": "auth.websiteMax",
  "Website must be a valid URL.": "auth.websiteInvalid",
  "Website must use http or https.": "auth.websiteProtocol",
  "Please enter a new password.": "auth.enterNewPassword",
  "Please confirm your new password.": "auth.confirmNewPassword",
};

export function authValidationMessage(message: string | undefined, t: TFunction): string {
  return t((message && validationKeys[message]) || 'auth.fillAllFields');
}
