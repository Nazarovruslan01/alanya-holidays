export interface InitialUrlParts {
  search: string;
  hash: string;
}

export function hasInitialImplicitRecoveryIntent({
  search,
  hash,
}: InitialUrlParts): boolean {
  const requiredParameters = [
    "access_token",
    "refresh_token",
    "expires_in",
    "token_type",
  ];
  const hasNonEmptyValue = new Map<string, boolean>();
  let isRecovery = false;

  const decodeParameterPart = (value: string): string | null => {
    try {
      return decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
      return null;
    }
  };

  // Match auth-js precedence: hash is parsed first and search parameters win.
  [hash, search].forEach((source) => {
    const parameterString = source.startsWith("#") || source.startsWith("?")
      ? source.slice(1)
      : source;

    parameterString.split("&").forEach((entry) => {
      const separatorIndex = entry.indexOf("=");
      const encodedName = separatorIndex >= 0
        ? entry.slice(0, separatorIndex)
        : entry;
      const name = decodeParameterPart(encodedName);
      if (!name) {
        return;
      }

      if (requiredParameters.includes(name)) {
        // Capture only whether a value exists; never read or retain the value.
        hasNonEmptyValue.set(
          name,
          separatorIndex >= 0 && separatorIndex < entry.length - 1
        );
      } else if (name === "type") {
        const encodedType = separatorIndex >= 0
          ? entry.slice(separatorIndex + 1)
          : "";
        isRecovery = decodeParameterPart(encodedType) === "recovery";
      }
    });
  });

  return isRecovery && requiredParameters.every(
    (name) => hasNonEmptyValue.get(name) === true
  );
}
