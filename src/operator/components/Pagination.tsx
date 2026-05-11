type PaginationProps = {
  page: number;
  pageSize?: number;
  totalItems: number;
  onPageChange: (page: number) => void;
};

export const operatorPageSize = 10;

export function getPageItems<T>(
  items: T[],
  page: number,
  pageSize = operatorPageSize,
): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function getPageCount(totalItems: number, pageSize = operatorPageSize): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function Pagination({
  page,
  pageSize = operatorPageSize,
  totalItems,
  onPageChange,
}: PaginationProps) {
  const pageCount = getPageCount(totalItems, pageSize);
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  return (
    <div className="pagination-bar">
      <span className="pagination-summary">
        {start}-{end} of {totalItems}
      </span>
      <div className="pagination-controls">
        <button
          className="btn btn-ghost"
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Previous
        </button>
        <span className="pagination-page">
          Page {page} / {pageCount}
        </span>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        >
          Next
        </button>
      </div>
    </div>
  );
}
