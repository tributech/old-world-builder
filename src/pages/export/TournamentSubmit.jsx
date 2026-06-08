import { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { Button } from "../../components/button";
import { checkAuth, owrApiFetch } from "../../utils/owr-sync";

import "./TournamentSubmit.css";

const formatDate = (isoDate) => {
  try {
    return new Date(isoDate).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
};

export const TournamentSubmit = ({ list }) => {
  const intl = useIntl();
  const [tournaments, setTournaments] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const authed = await checkAuth();
      if (cancelled || !authed) {
        setLoading(false);
        return;
      }
      fetchTournaments();
    };
    init();
    return () => { cancelled = true; };
  }, []);

  // Reset submitted state when selected tournament changes
  useEffect(() => {
    setSubmitted(false);
    setError(null);
  }, [selectedId]);

  const fetchTournaments = async () => {
    try {
      const res = await owrApiFetch("/api/builder/tournaments");
      if (res.ok) {
        const data = await res.json();
        const eligible = data.tournaments || [];
        setTournaments(eligible);
        if (eligible.length > 0) {
          setSelectedId(String(eligible[0].id));
        }
      }
    } catch (e) {
      console.warn("Failed to fetch tournaments:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedId || submitting) return;
    setSubmitting(true);
    setError(null);
    setSubmitted(false);

    try {
      const res = await owrApiFetch(
        `/api/builder/tournaments/${selectedId}/submit_list`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ list_json: list }),
        }
      );

      if (res.ok) {
        setSubmitted(true);
        // Re-fetch to update list_submitted status
        fetchTournaments();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error ||
            intl.formatMessage({ id: "export.tournament.submitError" })
        );
      }
    } catch {
      setError(
        intl.formatMessage({ id: "export.tournament.submitError" })
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || tournaments.length === 0) return null;

  const selected = tournaments.find((t) => String(t.id) === selectedId);
  const isSubmitted = selected?.list_submitted;

  return (
    <>
      <hr />
      <h2 className="export__subtitle">
        <FormattedMessage
          id={isSubmitted ? "export.tournament.titleSubmitted" : "export.tournament.title"}
        />
        <span className="tournament-submit__badge">
          <FormattedMessage id="export.tournament.new" />
        </span>
      </h2>
      <p>
        <FormattedMessage
          id={isSubmitted ? "export.tournament.descriptionSubmitted" : "export.tournament.description"}
        />
      </p>

      <select
        className="select tournament-submit__select"
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
      >
        {tournaments.map((t) => (
          <option key={t.id} value={String(t.id)}>
            {t.name} ({formatDate(t.start_date)})
            {t.list_submitted
              ? t.list_approved
                ? " 🟢 Approved"
                : " 🟠 Pending"
              : ""}
          </option>
        ))}
      </select>

      {selected && (
        <a
          href={selected.friendly_url}
          target="_blank"
          rel="noopener noreferrer"
          className="tournament-submit__link"
        >
          <FormattedMessage id="export.tournament.viewSelected" /> →
        </a>
      )}

      <Button
        icon={submitted ? "check" : "export"}
        onClick={handleSubmit}
        disabled={submitting || !selectedId}
      >
        {submitting
          ? intl.formatMessage({ id: "export.tournament.submitting" })
          : submitted
          ? intl.formatMessage({ id: "export.tournament.submitted" })
          : selected?.list_submitted
          ? intl.formatMessage({ id: "export.tournament.resubmit" })
          : intl.formatMessage({ id: "export.tournament.submit" })}
      </Button>

      {error && <p className="export__error">{error}</p>}
    </>
  );
};
