import "abortcontroller-polyfill/dist/abortcontroller-polyfill-only";

let controller;

const abortFetch = () => {
  controller && controller.abort();
};
export const fetcher = ({
  url,
  baseUrl = import.meta.env.BASE_URL || "/",
  appendJson = true,
  version,
  onSuccess,
  onError,
}) => {
  controller = new AbortController();

  fetch(
    `${baseUrl}${url}${appendJson ? ".json" : ""}?v=${
      version || import.meta.env.VITE_VERSION
    }`,
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: controller.signal,
    },
  )
    .then((response) => response.json())
    .then((data) => {
      if (onSuccess) {
        onSuccess(data);
      }
    })
    .catch((error) => {
      if (onError) {
        onError(error);
      }
    });
};

export { abortFetch };
