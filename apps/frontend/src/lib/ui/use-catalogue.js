'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { listAllPublicServices } from '../api/public-services.js';
import { PUBLIC_PAGE_SIZE, clampPage, filterServices, officeOptions, pageOf } from './public-catalogue.js';

// The search text, the filters, the view and the page, shared by the signed-out and signed-in home. One list of services (all the
// pages the public API returns for the search); classification, office, counting and paging are worked out from it, so the Grid and
// the List always show the same thing and switching view keeps every filter and the page.
export function useCatalogue(initialSearch = '') {
  const start = initialSearch.trim();
  const [input, setInput] = useState(start);
  const [search, setSearch] = useState(start);
  const [classification, setClassification] = useState('');
  const [office, setOffice] = useState('');
  const [view, setView] = useState('grid');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PUBLIC_PAGE_SIZE);
  const [attempt, setAttempt] = useState(0); // bumped by "Try again"
  const [state, setState] = useState({ loading: true, all: [], truncated: false, error: null });
  const latest = useRef(0); // the newest request; an older answer that arrives late is thrown away
  useEffect(() => {
    const id = ++latest.current;
    listAllPublicServices(search)
      .then((data) => {
        if (id === latest.current) setState({ loading: false, all: data.items, truncated: data.truncated, error: null });
      })
      .catch((err) => {
        if (id === latest.current) setState({ loading: false, all: [], truncated: false, error: err.message });
      });
    return () => {
      latest.current += 1;
    };
  }, [search, attempt]);

  const offices = useMemo(() => officeOptions(state.all, office), [state.all, office]);
  const filtered = useMemo(() => filterServices(state.all, { classification, office }), [state.all, classification, office]);
  const currentPage = clampPage(page, filtered.length, pageSize);
  const items = useMemo(() => pageOf(filtered, currentPage, pageSize), [filtered, currentPage, pageSize]);

  const loading = () => setState((s) => ({ ...s, loading: true, error: null }));

  function onSubmit(event) {
    event.preventDefault();
    if (input.trim() !== search.trim()) loading();
    setPage(1);
    setSearch(input.trim());
  }

  function onClear() {
    if (search) loading();
    setInput('');
    setSearch('');
    setClassification('');
    setOffice('');
    setPage(1);
  }

  function browseAll() {
    onClear();
    document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' });
  }

  function retry() {
    loading();
    setAttempt((n) => n + 1);
  }

  // A new classification or office starts again at page 1; changing the view or the page does not touch the filters.
  const chooseClassification = (value) => { setClassification(value); setPage(1); };
  const chooseOffice = (value) => { setOffice(value); setPage(1); };
  // A different page size starts again at page 1; the search and filters stay.
  const changePageSize = (size) => { setPageSize(size); setPage(1); };

  return { input, setInput, search, classification, office, view, setView, page: currentPage, setPage, pageSize, changePageSize, state, offices, items, total: filtered.length, onSubmit, onClear, browseAll, retry, chooseClassification, chooseOffice };
}
