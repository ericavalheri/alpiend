import { createContext, useContext } from 'react';

// Catálogo vem sempre do fetch em /api/health?resource=courses (ver App() em src/App.jsx) —
// este array vazio é só o valor inicial antes daquele fetch responder. Extraído de
// src/main.jsx (organização de arquivos pedida pela Erica, 05/09/2026).
export const courses = [];
export const CatalogContext = createContext(courses);

export function useCatalog() {
  return useContext(CatalogContext) || courses;
}
