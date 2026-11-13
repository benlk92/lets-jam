-- Per-category text for the Guided Picker's "Skip" button (null = "Skip").
alter table db_categories add column if not exists skip_label text;
