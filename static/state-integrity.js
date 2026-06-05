export function shouldApplyCharacterLoadResult({ currentRequestId, selectedChar, requestId, char }) {
  return requestId === currentRequestId && char === selectedChar;
}

export function isCurrentStudyRequest({ currentRequestId, requestId }) {
  return requestId === currentRequestId;
}

export function shouldApplyStudyError({ currentRequestId, requestId }) {
  return isCurrentStudyRequest({ currentRequestId, requestId });
}

export function shouldApplyCharacterPreviewResult({ currentPreviewChar, char }) {
  return currentPreviewChar === char;
}

export function activeNetworkIndexForReadingAction({
  currentActiveNetworkIndex,
  elementNetworkIndex,
  hasElementNetwork,
}) {
  const index = Number(elementNetworkIndex);
  if (!Number.isInteger(index) || index < 0 || !hasElementNetwork) {
    return currentActiveNetworkIndex;
  }
  return index;
}

export function shouldMountBundleScene({ currentRenderId, renderId }) {
  return renderId === currentRenderId;
}

export function normalizeSuperscriptToneDigits(value) {
  return String(value || "")
    .replaceAll("¹", "1")
    .replaceAll("²", "2")
    .replaceAll("³", "3")
    .replaceAll("⁴", "4")
    .replaceAll("⁵", "5")
    .replaceAll("⁶", "6");
}

export function normalizePinyinOrthography(value) {
  return normalizeSuperscriptToneDigits(String(value || "").trim().toLowerCase()).replaceAll("u:", "v");
}
