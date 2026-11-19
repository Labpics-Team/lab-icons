/** Привязка анатомии к мастеру; конструктивную модель или оси не удостоверяет. */
export interface AuthorAnatomyReceipt {
  readonly version: 1;
  readonly annotationSha256: string;
  readonly masterSha256: string;
  readonly pathFingerprintSha256: string;
}

/** Хеши относятся к закреплённым bytes/node/version, не к геометрической модели. */
export interface AuthorSourceProvenance {
  readonly kind: 'figma';
  readonly fileKey: string;
  readonly version: string;
  readonly nodeId: string;
  readonly nodeSha256: string;
  readonly masterSha256: string;
  readonly normalizedSha256: string;
  readonly pathFingerprintSha256: string;
}
