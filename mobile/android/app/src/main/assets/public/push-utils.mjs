export function normalizeTokens(tokens = []) {
  if (!Array.isArray(tokens)) {
    return [];
  }

  return Array.from(
    new Set(
      tokens
        .map((token) => {
          if (typeof token === 'string') {
            return token.trim();
          }
          if (token && typeof token === 'object') {
            return [token.token, token.fcmToken, token.value].find((value) => typeof value === 'string' && value.trim()) || '';
          }
          return '';
        })
        .filter(Boolean)
    )
  );
}

export function collectRecipientTokens({ tokenDocs = [], currentToken = '', fallbackTokens = [] } = {}) {
  const tokens = [];

  if (Array.isArray(tokenDocs)) {
    tokens.push(...tokenDocs.map((entry) => entry?.token || entry?.fcmToken || entry?.value));
  }

  if (typeof currentToken === 'string' && currentToken.trim()) {
    tokens.push(currentToken.trim());
  }

  if (Array.isArray(fallbackTokens)) {
    tokens.push(...fallbackTokens);
  }

  return normalizeTokens(tokens);
}
