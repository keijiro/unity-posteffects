#pragma strict

@script ExecuteInEditMode
@script RequireComponent(Camera)
@script AddComponentMenu("Image Effects/Vignetting")

class Vignetting extends PostEffectsBase {
    @Range(0.0, 6.0) var intensity = 0.375;
    @Range(0.0, 1.5) var blur = 0.1;
    @Range(0.0, 4.0) var blurSpread = 1.5;

    @HideInInspector var vignetteShader : Shader;
    private var vignetteMaterial : Material;
    @HideInInspector var separableBlurShader : Shader;
    private var separableBlurMaterial : Material;

    function CheckResources() {
        CheckSupport();
        vignetteMaterial = CheckShaderAndCreateMaterial(vignetteShader, vignetteMaterial);
        separableBlurMaterial = CheckShaderAndCreateMaterial(separableBlurShader, separableBlurMaterial);
        if (!isSupported) ReportAutoDisable();
        return isSupported;
    }

    function OnRenderImage(source : RenderTexture, destination : RenderTexture) {
        if (!CheckResources()) {
            Graphics.Blit(source, destination);
            return;
        }

        var widthOverHeight = (1.0 * source.width) / source.height;
        var oneOverBaseSize = 1.0 / 512;

        var halfRezColor = RenderTexture.GetTemporary(source.width / 2, source.height / 2, 0);
        var quarterRezColor = RenderTexture.GetTemporary(source.width / 4, source.height / 4, 0);
        var secondQuarterRezColor = RenderTexture.GetTemporary(source.width / 4, source.height / 4, 0);

        Graphics.Blit(source, halfRezColor);
        Graphics.Blit(halfRezColor, quarterRezColor);

        separableBlurMaterial.SetVector("offsets", Vector4(0.0, blurSpread * oneOverBaseSize, 0.0, 0.0));
        Graphics.Blit(quarterRezColor, secondQuarterRezColor, separableBlurMaterial, 0);
        separableBlurMaterial.SetVector("offsets", Vector4(blurSpread * oneOverBaseSize / widthOverHeight, 0.0, 0.0, 0.0));
        Graphics.Blit(secondQuarterRezColor, quarterRezColor, separableBlurMaterial, 0);

        vignetteMaterial.SetFloat("intensity", intensity);
        vignetteMaterial.SetFloat("blur", blur);
        vignetteMaterial.SetTexture("vignetteTex", quarterRezColor);
        Graphics.Blit(source, destination, vignetteMaterial, 0);
        
        RenderTexture.ReleaseTemporary(halfRezColor);           
        RenderTexture.ReleaseTemporary(quarterRezColor);    
        RenderTexture.ReleaseTemporary(secondQuarterRezColor);  
    }
}
