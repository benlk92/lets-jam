import type { Category, CategoryFilter, FilterState, RatingScaleEntry, Song } from '../types';
import { categoryValues, filterSongs } from '../lib/filtering';
import CategoryPicker from '../components/CategoryPicker';

interface GuidedPickerProps {
  categories: Category[];
  songs: Song[];
  ratingScale: RatingScaleEntry[];
  filters: FilterState;
  includeUntagged: boolean;
  step: number;
  onStepChange: (step: number) => void;
  onFilterChange: (categoryId: string, filter: CategoryFilter | undefined) => void;
  onShowResults: () => void;
}

export default function GuidedPicker({
  categories,
  songs,
  ratingScale,
  filters,
  includeUntagged,
  step,
  onStepChange,
  onFilterChange,
  onShowResults,
}: GuidedPickerProps) {
  const category = categories[step];
  const isLast = step === categories.length - 1;
  const matchCount = filterSongs(songs, filters, categories, includeUntagged).length;

  if (!category) return null;

  const options = categoryValues(songs, category.id, ratingScale, category.values);

  function goNext() {
    if (isLast) onShowResults();
    else onStepChange(step + 1);
  }

  // Guided Picker is single-select-only (see CategoryPicker), so picking a
  // value is always a single, complete decision for that category — same
  // reasoning Gap-Fill already uses to auto-advance single-select categories.
  function handleFilterChange(f: CategoryFilter | undefined) {
    onFilterChange(category.id, f);
    const madeASelection = !!f?.values?.length;
    if (!madeASelection) return;

    const nextFilters = { ...filters };
    if (f) nextFilters[category.id] = f;
    else delete nextFilters[category.id];
    const nextCount = filterSongs(songs, nextFilters, categories, includeUntagged).length;

    // Narrow enough to just look at the results rather than keep narrowing
    // through categories that likely won't change much at this point.
    if (nextCount < 20) onShowResults();
    else goNext();
  }

  return (
    <div className="screen picker">
      <div className="picker-header">
        <span className="picker-progress">
          Step {step + 1} of {categories.length}
        </span>
        <div className="match-count">
          <strong>{matchCount}</strong> song{matchCount === 1 ? '' : 's'} match
        </div>
      </div>

      <h2 className="picker-category-name">{category.name}</h2>

      <div className="picker-control">
        <CategoryPicker
          options={options}
          filter={filters[category.id]}
          onChange={handleFilterChange}
          large
          singleSelect
        />
        <button type="button" className="chip picker-skip" onClick={goNext}>
          {category.skipLabel || 'Skip'}
        </button>
      </div>

      <div className="picker-actions">
        {step > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => onStepChange(step - 1)}>
            Back
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={onShowResults}>
          Show Results
        </button>
      </div>
    </div>
  );
}
