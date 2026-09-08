export function evidenceDisplayLabel(library, id, index = 0) {
  const labels = Array.isArray(library?.document_labels) ? library.document_labels : [];
  const record = labels.find((item) => item?.id === id);
  const label = String(record?.label || "").trim();
  return label || `Documento ${index + 1}`;
}
