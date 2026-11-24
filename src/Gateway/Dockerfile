# Build context: repository root (see docker-compose.yml)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Directory.Build.props ./
COPY src/Gateway/Gateway.csproj src/Gateway/
RUN dotnet restore src/Gateway/Gateway.csproj

COPY src/Gateway/ src/Gateway/
RUN dotnet publish src/Gateway/Gateway.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Gateway.dll"]
