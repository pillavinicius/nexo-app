export function evidenceDisplayLabel(library, id, index = 0) {
  const labels = Array.isArray(library?.document_labels) ? library.document_labels : [];
  const record = labels.find((item) => item?.id === id);
  const label = String(record?.label || "").trim();
  return label || `Documento ${index + 1}`;
}

export function evidenceSourceDisplayLabel(library, source, index = 0) {
  const id = String(source || "").trim();
  return /^(?:cvm_ipe|cvm_fnet|cvm_rad|ri):/i.test(id)
    ? evidenceDisplayLabel(library, id, index)
    : id || "DEEP";
}
