\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`
\set worker_dispatch_url `echo "$WORKER_DISPATCH_URL"`
\set worker_secret `echo "$WORKER_SECRET"`

ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
ALTER DATABASE postgres SET "app.worker_dispatch_url" TO :'worker_dispatch_url';
ALTER DATABASE postgres SET "app.worker_secret" TO :'worker_secret';
