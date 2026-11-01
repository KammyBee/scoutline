export function FitBars({ fit }: { fit: number }) {
  return (
    <span className="fit" title={`Fit ${fit} of 5`} aria-label={`Fit ${fit} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= fit ? "on" : ""} style={{ height: 4 + i * 2.4 + "px" }} />
      ))}
    </span>
  );
}
