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
