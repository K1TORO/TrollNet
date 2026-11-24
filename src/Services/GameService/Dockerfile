# Build context: repository root (see docker-compose.yml)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Directory.Build.props ./
COPY src/Shared/TrollNet.Shared/TrollNet.Shared.csproj src/Shared/TrollNet.Shared/
COPY src/Services/GameService/GameService.csproj src/Services/GameService/
RUN dotnet restore src/Services/GameService/GameService.csproj

COPY src/Shared/ src/Shared/
COPY src/Services/GameService/ src/Services/GameService/
RUN dotnet publish src/Services/GameService/GameService.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
# Npgsql looks for Kerberos (GSSAPI) support at startup; installing it avoids an error message in the logs.
RUN apt-get update && apt-get install -y --no-install-recommends libgssapi-krb5-2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/publish .
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "GameService.dll"]
