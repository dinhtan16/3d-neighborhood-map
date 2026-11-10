export function MapLoading({ label = 'Đang tải bản đồ…', error }: { label?: string; error?: string | null }) {
  return (
    <div className="map-loading" role="status">
      {error ? (
        <>
          <strong>Không tải được bản đồ</strong>
          <span className="muted">{error}</span>
        </>
      ) : (
        <>
          <div className="spinner" />
          <span>{label}</span>
        </>
      )}
    </div>
  );
}
